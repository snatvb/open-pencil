//! System font discovery through fontique, which reads each face's attributes from the font
//! files the platform reports.

use fontique::{Blob, Collection, CollectionOptions, FontInfo, FontStyle, SourceCache, SourceKind};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Cursor};
use std::sync::{Mutex, OnceLock};

use super::sfnt::face_names;
use super::style::{
    legacy_family_names, named_weight, names_only_weight_and_slant, RequestedFace, NORMAL_WIDTH,
};

struct Catalog {
    collection: Collection,
    cache: SourceCache,
}

static CATALOG: OnceLock<Mutex<Catalog>> = OnceLock::new();
static FACE_NAMES: OnceLock<FaceNameIndex> = OnceLock::new();

fn with_catalog<T>(f: impl FnOnce(&mut Catalog) -> T) -> T {
    let catalog = CATALOG.get_or_init(|| {
        Mutex::new(Catalog {
            collection: Collection::new(CollectionOptions {
                shared: false,
                system_fonts: true,
            }),
            cache: SourceCache::default(),
        })
    });
    let mut catalog = catalog
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut catalog)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FaceTraits {
    pub weight: f32,
    pub italic: bool,
    pub width: f32,
    /// The range of a variable font's `wght` axis.
    pub weight_axis: Option<(f32, f32)>,
}

impl FaceTraits {
    fn of(font: &FontInfo) -> Self {
        Self {
            weight: font.weight().value(),
            italic: !matches!(font.style(), FontStyle::Normal),
            width: font.width().ratio(),
            weight_axis: font
                .axes()
                .iter()
                .find(|axis| axis.tag == *b"wght")
                .map(|axis| (axis.min, axis.max)),
        }
    }
}

pub struct Face {
    pub data: Blob<u8>,
    pub index: u32,
}

fn width_side(width: f32) -> Ordering {
    if (width - NORMAL_WIDTH).abs() < 0.01 {
        Ordering::Equal
    } else {
        width.total_cmp(&NORMAL_WIDTH)
    }
}

/// Picks the face listed under the requested named weight and slant, or a variable face whose
/// weight axis covers the request, among faces as narrow, normal, or wide as the request, the
/// nearest width first. Other static weights are not substituted, so callers can report the
/// substitution.
pub fn choose_face(faces: &[FaceTraits], request: RequestedFace) -> Option<usize> {
    let nearest = |fits: &dyn Fn(&FaceTraits) -> bool| {
        faces
            .iter()
            .enumerate()
            .filter(|(_, face)| {
                face.italic == request.italic
                    && width_side(face.width) == width_side(request.width)
                    && fits(face)
            })
            .min_by(|(_, a), (_, b)| {
                (a.width - request.width)
                    .abs()
                    .total_cmp(&(b.width - request.width).abs())
            })
            .map(|(position, _)| position)
    };
    nearest(&|face| named_weight(face.weight) == request.weight).or_else(|| {
        nearest(&|face| {
            face.weight_axis
                .is_some_and(|(min, max)| (min..=max).contains(&request.weight))
        })
    })
}

/// Visible family names with the traits of each face.
pub fn families() -> Vec<(String, Vec<FaceTraits>)> {
    with_catalog(|catalog| {
        let names: Vec<String> = catalog
            .collection
            .family_names()
            .filter(|name| !name.starts_with('.'))
            .map(String::from)
            .collect();
        names
            .into_iter()
            .filter_map(|name| {
                let family = catalog.collection.family_by_name(&name)?;
                let faces = family.fonts().iter().map(FaceTraits::of).collect();
                Some((name, faces))
            })
            .collect()
    })
}

fn face_in_family(
    collection: &mut Collection,
    name: &str,
    request: RequestedFace,
) -> Option<FontInfo> {
    let family = collection.family_by_name(name)?;
    let traits: Vec<FaceTraits> = family.fonts().iter().map(FaceTraits::of).collect();
    family.fonts().get(choose_face(&traits, request)?).cloned()
}

fn names_of(font: &FontInfo) -> Vec<String> {
    let names = match font.source().kind() {
        SourceKind::Path(path) => File::open(path)
            .ok()
            .and_then(|file| face_names(&mut BufReader::new(file), font.index())),
        SourceKind::Memory(data) => face_names(&mut Cursor::new(data.as_ref()), font.index()),
    };
    names.unwrap_or_default()
}

#[derive(Clone, Debug, PartialEq)]
struct FacePosition {
    family: String,
    position: usize,
}

#[derive(Default)]
struct FaceNameIndex {
    faces: HashMap<String, FacePosition>,
}

impl FaceNameIndex {
    fn build(faces: impl IntoIterator<Item = (FacePosition, Vec<String>)>) -> Self {
        let mut index = HashMap::new();
        for (face, names) in faces {
            for name in names {
                index
                    .entry(name.to_lowercase())
                    .or_insert_with(|| face.clone());
            }
        }
        Self { faces: index }
    }

    fn find(&self, names: &[String]) -> Option<&FacePosition> {
        names
            .iter()
            .find_map(|name| self.faces.get(&name.to_lowercase()))
    }
}

fn listed_faces(collection: &mut Collection) -> Vec<(FacePosition, FontInfo)> {
    let families: Vec<String> = collection.family_names().map(String::from).collect();
    let mut faces = Vec::new();
    for family in families {
        let Some(listed) = collection.family_by_name(&family) else {
            continue;
        };
        for (position, font) in listed.fonts().iter().enumerate() {
            let face = FacePosition {
                family: family.clone(),
                position,
            };
            faces.push((face, font.clone()));
        }
    }
    faces
}

fn face_name_index() -> &'static FaceNameIndex {
    FACE_NAMES.get_or_init(|| {
        let listed = with_catalog(|catalog| listed_faces(&mut catalog.collection));
        FaceNameIndex::build(
            listed
                .into_iter()
                .map(|(face, font)| (face, names_of(&font))),
        )
    })
}

#[derive(Debug, PartialEq)]
struct FaceLookup {
    families: Vec<String>,
    face_names: Option<Vec<String>>,
}

fn face_lookup(family: &str, style: &str, postscript_name: Option<&str>) -> FaceLookup {
    let families = std::iter::once(family.to_string())
        .chain(legacy_family_names(family, style))
        .collect();
    let by_name = postscript_name.is_some() || !names_only_weight_and_slant(style);
    let face_names = by_name.then(|| {
        postscript_name
            .map(String::from)
            .into_iter()
            .chain([format!("{family} {style}")])
            .collect()
    });
    FaceLookup {
        families,
        face_names,
    }
}

fn loaded(catalog: &mut Catalog, font: &FontInfo) -> Option<Face> {
    Some(Face {
        data: font.load(Some(&mut catalog.cache))?,
        index: font.index(),
    })
}

fn load_named_face(names: &[String]) -> Option<Face> {
    let face = face_name_index().find(names)?.clone();
    with_catalog(|catalog| {
        let font = catalog
            .collection
            .family_by_name(&face.family)?
            .fonts()
            .get(face.position)
            .cloned()?;
        loaded(catalog, &font)
    })
}

pub fn load_face(
    family: &str,
    style: &str,
    request: RequestedFace,
    postscript_name: Option<&str>,
) -> Option<Face> {
    let lookup = face_lookup(family, style, postscript_name);
    let in_family = with_catalog(|catalog| {
        let font = lookup
            .families
            .iter()
            .find_map(|name| face_in_family(&mut catalog.collection, name, request))?;
        loaded(catalog, &font)
    });
    in_family.or_else(|| load_named_face(lookup.face_names.as_deref()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(weight: f32, italic: bool) -> FaceTraits {
        FaceTraits {
            weight,
            italic,
            width: NORMAL_WIDTH,
            weight_axis: None,
        }
    }

    fn request(weight: f32, italic: bool) -> RequestedFace {
        RequestedFace {
            weight,
            italic,
            width: NORMAL_WIDTH,
        }
    }

    #[test]
    fn chooses_the_exact_weight_and_slant() {
        let faces = [
            face(400.0, false),
            face(400.0, true),
            face(700.0, false),
            face(700.0, true),
        ];
        assert_eq!(choose_face(&faces, request(700.0, true)), Some(3));
        assert_eq!(choose_face(&faces, request(400.0, false)), Some(0));
    }

    #[test]
    fn does_not_substitute_a_nearby_static_weight() {
        assert_eq!(
            choose_face(&[face(400.0, false)], request(700.0, false)),
            None
        );
        assert_eq!(
            choose_face(&[face(400.0, true)], request(400.0, false)),
            None
        );
    }

    #[test]
    fn chooses_static_faces_by_the_style_they_are_listed_under() {
        assert_eq!(
            choose_face(&[face(450.0, false)], request(400.0, false)),
            Some(0)
        );
        assert_eq!(
            choose_face(&[face(450.0, false)], request(500.0, false)),
            None
        );
        assert_eq!(
            choose_face(&[face(510.0, false)], request(500.0, false)),
            Some(0)
        );
    }

    #[test]
    fn uses_a_variable_face_whose_weight_axis_covers_the_request() {
        let variable = FaceTraits {
            weight_axis: Some((1.0, 1000.0)),
            ..face(400.0, false)
        };
        let italic = FaceTraits {
            italic: true,
            ..variable
        };
        assert_eq!(
            choose_face(&[variable, italic], request(500.0, false)),
            Some(0)
        );
        assert_eq!(
            choose_face(&[variable, italic], request(700.0, true)),
            Some(1)
        );
        let narrow = FaceTraits {
            weight_axis: Some((300.0, 600.0)),
            ..variable
        };
        assert_eq!(choose_face(&[narrow], request(700.0, false)), None);
    }

    #[test]
    fn chooses_among_faces_as_wide_as_the_request() {
        let condensed = FaceTraits {
            width: 0.75,
            ..face(500.0, false)
        };
        let compressed = FaceTraits {
            width: 0.625,
            ..condensed
        };
        let faces = [condensed, face(500.0, false), compressed];
        let compressed_medium = RequestedFace {
            width: 0.625,
            ..request(500.0, false)
        };
        assert_eq!(choose_face(&faces, compressed_medium), Some(2));
        assert_eq!(choose_face(&faces, request(500.0, false)), Some(1));
        assert_eq!(choose_face(&[face(500.0, false)], compressed_medium), None);
    }

    fn position(family: &str, position: usize) -> FacePosition {
        FacePosition {
            family: family.to_string(),
            position,
        }
    }

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn finds_a_face_by_any_of_its_names_ignoring_case() {
        let index = FaceNameIndex::build([
            (
                position("Acme Sans", 0),
                names(&["Acme Sans Regular", "AcmeSans-Regular"]),
            ),
            (
                position("Acme Sans Compressed Medium", 0),
                names(&["Acme Sans Compressed Medium", "AcmeSans-CompressedMedium"]),
            ),
        ]);
        assert_eq!(
            index.find(&names(&["acmesans-compressedmedium"])),
            Some(&position("Acme Sans Compressed Medium", 0))
        );
        assert_eq!(
            index.find(&names(&["Foo-Bold", "Acme Sans Regular"])),
            Some(&position("Acme Sans", 0))
        );
        assert_eq!(index.find(&names(&["Foo-Bold"])), None);
    }

    #[test]
    fn keeps_the_first_face_listed_under_a_name() {
        let index = FaceNameIndex::build([
            (position("Foo", 0), names(&["Foo-Bold"])),
            (position("Foo", 1), names(&["Foo-Bold"])),
        ]);
        assert_eq!(index.find(&names(&["Foo-Bold"])), Some(&position("Foo", 0)));
    }

    #[test]
    fn looks_in_the_family_then_where_windows_registers_the_face_then_by_name() {
        assert_eq!(
            face_lookup(
                "Acme",
                "Compressed Medium Italic",
                Some("Acme-CompressedMediumItalic")
            ),
            FaceLookup {
                families: names(&["Acme", "Acme Compressed Medium"]),
                face_names: Some(names(&[
                    "Acme-CompressedMediumItalic",
                    "Acme Compressed Medium Italic"
                ])),
            }
        );
    }

    #[test]
    fn looks_a_face_up_by_name_only_for_a_postscript_name_or_a_style_beyond_weight_and_slant() {
        assert_eq!(face_lookup("Foo", "Bold Italic", None).face_names, None);
        assert_eq!(face_lookup("Foo", "Regular", None).face_names, None);
        assert_eq!(face_lookup("Foo", "Medium", None).face_names, None);
        assert_eq!(face_lookup("Foo", "Light", None).face_names, None);
        assert_eq!(face_lookup("Foo", "SemiBold Italic", None).face_names, None);
        assert_eq!(
            face_lookup("Foo", "Compressed Medium", None).face_names,
            Some(names(&["Foo Compressed Medium"]))
        );
        assert_eq!(
            face_lookup("Foo", "Display", None).face_names,
            Some(names(&["Foo Display"]))
        );
        assert_eq!(
            face_lookup("Foo", "Bold", Some("Foo-Bold")).face_names,
            Some(names(&["Foo-Bold", "Foo Bold"]))
        );
    }
}
