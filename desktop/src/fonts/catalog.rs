//! System font discovery through fontique, which reads each face's attributes from the font
//! files the platform reports.

use fontique::{Blob, Collection, CollectionOptions, FontInfo, FontStyle, SourceCache};
use std::sync::{Mutex, OnceLock};

use super::names::{face_names, spelling, typographic_family, FaceNames};
use super::style::{named_weight, names_weight, requested_face, style_name};

struct Catalog {
    collection: Collection,
    cache: SourceCache,
    listed_elsewhere: Option<Vec<ListedElsewhere>>,
}

/// A face Windows lists under a family other than the one its font names, as it lists a variable
/// font's optical sizes or a face beyond regular, bold, and italic as families of their own.
#[derive(Clone, Debug, PartialEq)]
pub struct ListedElsewhere {
    pub family: String,
    pub listed: String,
    pub position: usize,
}

static CATALOG: OnceLock<Mutex<Catalog>> = OnceLock::new();

fn with_catalog<T>(f: impl FnOnce(&mut Catalog) -> T) -> T {
    let catalog = CATALOG.get_or_init(|| {
        Mutex::new(Catalog {
            collection: Collection::new(CollectionOptions {
                shared: false,
                system_fonts: true,
            }),
            cache: SourceCache::default(),
            listed_elsewhere: None,
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
    /// The range of a variable font's `wght` axis.
    pub weight_axis: Option<(f32, f32)>,
}

impl FaceTraits {
    fn of(font: &FontInfo) -> Self {
        Self {
            weight: font.weight().value(),
            italic: !matches!(font.style(), FontStyle::Normal),
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

/// Picks the face listed under the requested named weight and slant, or a variable face whose
/// weight axis covers the request. Other static weights are not substituted, so callers can report
/// the substitution.
pub fn choose_face(faces: &[FaceTraits], weight: f32, italic: bool) -> Option<usize> {
    let same_slant = |face: &&FaceTraits| face.italic == italic;
    faces
        .iter()
        .position(|face| same_slant(&face) && named_weight(face.weight) == weight)
        .or_else(|| {
            faces.iter().position(|face| {
                same_slant(&face)
                    && face
                        .weight_axis
                        .is_some_and(|(min, max)| (min..=max).contains(&weight))
            })
        })
}

/// A face as the frontend lists it: the name its font gives it, its weight, and its slant.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ListedFace {
    pub style: String,
    pub weight: f32,
    pub italic: bool,
}

/// The faces a font file draws, by the names it gives them: each named instance of a variable
/// font, at its weight, else the face's own style name. A face whose font names it nothing takes
/// the standard name of its weight.
pub fn listed_faces(traits: &FaceTraits, names: &FaceNames) -> Vec<ListedFace> {
    let mut faces: Vec<ListedFace> = names
        .instances
        .iter()
        .map(|instance| ListedFace {
            style: instance.name.clone(),
            weight: instance.weight.unwrap_or(traits.weight),
            italic: traits.italic,
        })
        .collect();
    // The face the file draws by default, unless one of its instances already names it.
    let own = names
        .style
        .clone()
        .unwrap_or_else(|| style_name(traits.weight, traits.italic));
    if !faces
        .iter()
        .any(|face| spelling(&face.style) == spelling(&own))
    {
        faces.push(ListedFace {
            style: own,
            weight: traits.weight,
            italic: traits.italic,
        });
    }
    faces
}

/// Picks the face `style` names: the face of that name, or a variable face with an instance of
/// it, compared without case or spaces. A name that only names a weight falls back to that
/// weight's face, as before faces had names; any other name is that face or none.
pub fn choose_named_face(faces: &[(FaceTraits, FaceNames)], style: &str) -> Option<usize> {
    let wanted = spelling(style);
    // One pass in the order `families` lists them: the first font that names the face, by one
    // of its instances or its own name (a variable font's own face is listed beside them).
    let named = faces.iter().position(|(_, names)| {
        names
            .instances
            .iter()
            .any(|instance| spelling(&instance.name) == wanted)
            || names.style.as_deref().map(spelling) == Some(wanted.clone())
    });
    named.or_else(|| {
        if !names_weight(style) {
            return None;
        }
        let (weight, italic) = requested_face(style);
        let traits: Vec<FaceTraits> = faces.iter().map(|(traits, _)| *traits).collect();
        choose_face(&traits, weight, italic)
    })
}

/// The names a face's font gives it, read from the font file without caching its data.
fn names_of(font: &FontInfo) -> FaceNames {
    font.load(None)
        .map(|data| face_names(data.as_ref(), font.index()))
        .unwrap_or_default()
}

/// Visible family names with each face they list, by the names their fonts give them.
pub fn families() -> Vec<(String, Vec<ListedFace>)> {
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
                let mut faces: Vec<ListedFace> = Vec::new();
                for font in family.fonts() {
                    for face in listed_faces(&FaceTraits::of(font), &names_of(font)) {
                        // An upright and an italic file may each name an instance "Bold".
                        if !faces.iter().any(|listed| {
                            spelling(&listed.style) == spelling(&face.style)
                                && listed.italic == face.italic
                        }) {
                            faces.push(face);
                        }
                    }
                }
                Some((name, faces))
            })
            .collect()
    })
}

/// The face of `family` that `style` names, as `choose_named_face` picks it: among the faces
/// listed under `family`, else among those whose font names `family` but are listed elsewhere.
pub fn load_face(family: &str, style: &str) -> Option<Face> {
    with_catalog(|catalog| {
        let listed = catalog
            .collection
            .family_by_name(family)
            .map(|info| info.fonts().to_vec())
            .unwrap_or_default();
        named_face(catalog, &listed, style).or_else(|| {
            let elsewhere = fonts_listed_elsewhere(catalog, family);
            named_face(catalog, &elsewhere, style)
        })
    })
}

fn named_face(catalog: &mut Catalog, fonts: &[FontInfo], style: &str) -> Option<Face> {
    let faces: Vec<(FaceTraits, FaceNames)> = fonts
        .iter()
        .map(|font| (FaceTraits::of(font), names_of(font)))
        .collect();
    let font = &fonts[choose_named_face(&faces, style)?];
    Some(Face {
        data: font.load(Some(&mut catalog.cache))?,
        index: font.index(),
    })
}

fn fonts_listed_elsewhere(catalog: &mut Catalog, family: &str) -> Vec<FontInfo> {
    let index = catalog
        .listed_elsewhere
        .get_or_insert_with(|| index_listed_elsewhere(&mut catalog.collection))
        .clone();
    listed_elsewhere_of(&index, family)
        .filter_map(|face| {
            let listed = catalog.collection.family_by_name(&face.listed)?;
            listed.fonts().get(face.position).cloned()
        })
        .collect()
}

pub fn listed_elsewhere_of<'a>(
    index: &'a [ListedElsewhere],
    family: &str,
) -> impl Iterator<Item = &'a ListedElsewhere> {
    let wanted = spelling(family);
    index
        .iter()
        .filter(move |face| spelling(&face.family) == wanted)
}

fn index_listed_elsewhere(collection: &mut Collection) -> Vec<ListedElsewhere> {
    let names: Vec<String> = collection
        .family_names()
        .filter(|name| !name.starts_with('.'))
        .map(String::from)
        .collect();
    let mut index = Vec::new();
    for listed in names {
        let Some(info) = collection.family_by_name(&listed) else {
            continue;
        };
        for (position, font) in info.fonts().iter().enumerate() {
            let named = font
                .load(None)
                .and_then(|data| typographic_family(data.as_ref(), font.index()));
            if let Some(family) = named.filter(|family| spelling(family) != spelling(&listed)) {
                index.push(ListedElsewhere {
                    family,
                    listed: listed.clone(),
                    position,
                });
            }
        }
    }
    index
}

#[cfg(test)]
mod tests {
    use super::super::names::NamedInstance;
    use super::*;

    fn face(weight: f32, italic: bool) -> FaceTraits {
        FaceTraits {
            weight,
            italic,
            weight_axis: None,
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
        assert_eq!(choose_face(&faces, 700.0, true), Some(3));
        assert_eq!(choose_face(&faces, 400.0, false), Some(0));
    }

    #[test]
    fn does_not_substitute_a_nearby_static_weight() {
        assert_eq!(choose_face(&[face(400.0, false)], 700.0, false), None);
        assert_eq!(choose_face(&[face(400.0, true)], 400.0, false), None);
    }

    #[test]
    fn chooses_static_faces_by_the_style_they_are_listed_under() {
        assert_eq!(choose_face(&[face(450.0, false)], 400.0, false), Some(0));
        assert_eq!(choose_face(&[face(450.0, false)], 500.0, false), None);
        assert_eq!(choose_face(&[face(510.0, false)], 500.0, false), Some(0));
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
        assert_eq!(choose_face(&[variable, italic], 500.0, false), Some(0));
        assert_eq!(choose_face(&[variable, italic], 700.0, true), Some(1));
        let narrow = FaceTraits {
            weight_axis: Some((300.0, 600.0)),
            ..variable
        };
        assert_eq!(choose_face(&[narrow], 700.0, false), None);
    }

    fn listed(family: &str, listed: &str, position: usize) -> ListedElsewhere {
        ListedElsewhere {
            family: family.to_string(),
            listed: listed.to_string(),
            position,
        }
    }

    #[test]
    fn finds_the_faces_listed_under_another_family_by_the_family_their_font_names() {
        let index = [
            listed("Acme Sans", "Acme Sans Compressed", 0),
            listed("Acme Sans", "Acme Sans Compressed", 1),
            listed("Acme Serif", "Acme Serif Display", 0),
        ];
        let found: Vec<_> = listed_elsewhere_of(&index, "acme sans").collect();
        assert_eq!(found, vec![&index[0], &index[1]]);
        assert_eq!(listed_elsewhere_of(&index, "Acme Mono").count(), 0);
    }

    fn named(style: &str) -> FaceNames {
        FaceNames {
            style: Some(style.to_string()),
            instances: Vec::new(),
        }
    }

    #[test]
    fn chooses_a_static_face_by_its_own_name() {
        let faces = [
            (face(400.0, false), named("Roman")),
            (face(350.0, false), named("Book")),
            (face(700.0, false), named("Condensed Bold")),
            (face(700.0, false), named("Bold")),
        ];
        assert_eq!(choose_named_face(&faces, "Book"), Some(1));
        assert_eq!(choose_named_face(&faces, "condensed bold"), Some(2));
        // A weight name falls back to that weight's face; another name is that face or none.
        assert_eq!(choose_named_face(&faces, "Regular"), Some(0));
        assert_eq!(choose_named_face(&faces, "Heavy"), None);
    }

    #[test]
    fn chooses_a_variable_face_by_one_of_its_instances() {
        let variable = FaceNames {
            style: Some("Regular".to_string()),
            instances: vec![
                NamedInstance {
                    name: "Bold".to_string(),
                    weight: Some(700.0),
                },
                NamedInstance {
                    name: "Condensed Bold".to_string(),
                    weight: Some(700.0),
                },
            ],
        };
        let faces = [(face(400.0, false), variable)];
        assert_eq!(choose_named_face(&faces, "Condensed Bold"), Some(0));
        assert_eq!(choose_named_face(&faces, "Condensed Black"), None);
    }

    #[test]
    fn loads_a_variable_face_by_its_own_name_beside_its_instances() {
        let variable = FaceNames {
            style: Some("Text".to_string()),
            instances: vec![NamedInstance {
                name: "Display".to_string(),
                weight: Some(400.0),
            }],
        };
        let faces = [(face(400.0, false), variable)];
        assert_eq!(choose_named_face(&faces, "Text"), Some(0));
        assert_eq!(choose_named_face(&faces, "Display"), Some(0));
    }

    #[test]
    fn loads_the_font_the_listing_takes_a_name_from() {
        // An earlier variable font lists "Display" as an instance; a later font is named so.
        let variable = FaceNames {
            style: Some("Text".to_string()),
            instances: vec![NamedInstance {
                name: "Display".to_string(),
                weight: Some(700.0),
            }],
        };
        let faces = [
            (face(400.0, false), variable),
            (face(700.0, false), named("Display")),
        ];
        assert_eq!(choose_named_face(&faces, "Display"), Some(0));
    }

    #[test]
    fn keeps_a_variable_face_s_default_when_no_instance_names_it() {
        let variable = FaceNames {
            style: Some("Text".to_string()),
            instances: vec![NamedInstance {
                name: "Display".to_string(),
                weight: Some(400.0),
            }],
        };
        let styles: Vec<String> = listed_faces(&face(400.0, false), &variable)
            .into_iter()
            .map(|listed| listed.style)
            .collect();
        assert_eq!(styles, ["Display", "Text"]);
    }

    #[test]
    fn lists_a_variable_face_by_its_instances_and_a_static_one_by_its_name() {
        let variable = FaceNames {
            style: Some("Retina".to_string()),
            instances: vec![NamedInstance {
                name: "Retina".to_string(),
                weight: Some(450.0),
            }],
        };
        assert_eq!(
            listed_faces(&face(400.0, false), &variable),
            [ListedFace {
                style: "Retina".to_string(),
                weight: 450.0,
                italic: false
            }]
        );
        assert_eq!(
            listed_faces(&face(350.0, false), &named("Book")),
            [ListedFace {
                style: "Book".to_string(),
                weight: 350.0,
                italic: false
            }]
        );
        assert_eq!(
            listed_faces(&face(700.0, true), &FaceNames::default()),
            [ListedFace {
                style: "Bold Italic".to_string(),
                weight: 700.0,
                italic: true
            }]
        );
    }
}
