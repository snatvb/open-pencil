//! Named font styles the frontend uses and the weights they stand for.

/// Style names by the weight each stands for, lightest first.
const WEIGHT_STYLES: [(f32, &str); 9] = [
    (100.0, "Thin"),
    (200.0, "ExtraLight"),
    (300.0, "Light"),
    (400.0, "Regular"),
    (500.0, "Medium"),
    (600.0, "SemiBold"),
    (700.0, "Bold"),
    (800.0, "ExtraBold"),
    (900.0, "Black"),
];

/// The named weight nearest to `weight`; a tie goes to the lighter name.
pub fn named_weight(weight: f32) -> f32 {
    WEIGHT_STYLES
        .iter()
        .map(|(named, _)| *named)
        .min_by(|a, b| (a - weight).abs().total_cmp(&(b - weight).abs()))
        .unwrap_or(400.0)
}

/// The style name for a named weight, such as `SemiBold Italic` for 600 italic.
pub fn style_name(weight: f32, italic: bool) -> String {
    let named = named_weight(weight);
    let name = WEIGHT_STYLES
        .iter()
        .find(|(candidate, _)| *candidate == named)
        .map_or("Regular", |(_, name)| name);
    if italic {
        format!("{name} Italic")
    } else {
        name.to_string()
    }
}

const WEIGHT_NAMES: [(&str, f32); 15] = [
    ("thin", 100.0),
    ("hairline", 100.0),
    ("extrathin", 100.0),
    ("ultrathin", 100.0),
    ("extralight", 200.0),
    ("ultralight", 200.0),
    ("light", 300.0),
    ("medium", 500.0),
    ("semibold", 600.0),
    ("demibold", 600.0),
    ("bold", 700.0),
    ("extrabold", 800.0),
    ("ultrabold", 800.0),
    ("black", 900.0),
    ("heavy", 900.0),
];

const WIDTH_NAMES: [(&str, f32); 19] = [
    ("ultracompressed", 0.5),
    ("extracompressed", 0.5),
    ("ultracondensed", 0.5),
    ("extracondensed", 0.625),
    ("semicompressed", 0.75),
    ("demicondensed", 0.875),
    ("semicondensed", 0.875),
    ("ultraextended", 2.0),
    ("ultraexpanded", 2.0),
    ("extraextended", 1.5),
    ("extraexpanded", 1.5),
    ("semiextended", 1.125),
    ("semiexpanded", 1.125),
    ("compressed", 0.625),
    ("condensed", 0.75),
    ("extended", 1.25),
    ("expanded", 1.25),
    ("narrow", 0.75),
    ("wide", 1.25),
];

pub const NORMAL_WIDTH: f32 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RequestedFace {
    pub weight: f32,
    pub italic: bool,
    pub width: f32,
}

fn compact(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn weight_of(name: &str) -> f32 {
    if let Ok(weight) = name.parse::<f32>() {
        return weight;
    }
    WEIGHT_NAMES
        .iter()
        .find(|(candidate, _)| *candidate == name)
        .map_or(400.0, |(_, weight)| *weight)
}

fn upright_name(compacted: &str) -> String {
    compacted
        .replacen("italic", "", 1)
        .replacen("oblique", "", 1)
}

pub fn requested_face(style: &str) -> RequestedFace {
    let compacted = compact(style);
    let italic = compacted.contains("italic") || compacted.contains("oblique");
    let upright = upright_name(&compacted);
    let (width_name, width) = WIDTH_NAMES
        .iter()
        .filter(|(name, _)| upright.contains(name))
        .max_by_key(|(name, _)| name.len())
        .copied()
        .unwrap_or(("", NORMAL_WIDTH));
    RequestedFace {
        weight: weight_of(&upright.replacen(width_name, "", 1)),
        italic,
        width,
    }
}

const REGULAR_NAMES: [&str; 5] = ["regular", "normal", "book", "roman", "plain"];

fn names_a_weight(name: &str) -> bool {
    name.is_empty()
        || REGULAR_NAMES.contains(&name)
        || WEIGHT_NAMES.iter().any(|(candidate, _)| *candidate == name)
        || matches!(name.as_bytes(), [b'1'..=b'9', b'0', b'0'])
}

pub fn names_only_weight_and_slant(style: &str) -> bool {
    names_a_weight(&upright_name(&compact(style)))
}

const SLANT_WORDS: [&str; 2] = ["italic", "oblique"];
const RIBBI_WORDS: [&str; 4] = ["italic", "oblique", "bold", "regular"];

fn style_without(style: &str, dropped: &[&str]) -> String {
    style
        .split_whitespace()
        .filter(|word| !dropped.contains(&word.to_ascii_lowercase().as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn legacy_family_names(family: &str, style: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for dropped in [&SLANT_WORDS[..], &RIBBI_WORDS[..]] {
        let rest = style_without(style, dropped);
        let name = format!("{family} {rest}");
        if !rest.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// The styles a face can render: its own for a static face, and every named weight inside the
/// `wght` axis for a variable one.
pub fn face_styles(weight: f32, italic: bool, weight_axis: Option<(f32, f32)>) -> Vec<String> {
    match weight_axis {
        Some((min, max)) => WEIGHT_STYLES
            .iter()
            .filter(|(named, _)| (min..=max).contains(named))
            .map(|(named, _)| style_name(*named, italic))
            .collect(),
        None => vec![style_name(weight, italic)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(weight: f32, italic: bool, width: f32) -> RequestedFace {
        RequestedFace {
            weight,
            italic,
            width,
        }
    }

    #[test]
    fn maps_style_names_to_weight_and_slant() {
        assert_eq!(requested_face("Regular"), face(400.0, false, 1.0));
        assert_eq!(requested_face("SemiBold Italic"), face(600.0, true, 1.0));
        assert_eq!(requested_face("Italic"), face(400.0, true, 1.0));
        assert_eq!(requested_face("Unknown"), face(400.0, false, 1.0));
    }

    #[test]
    fn takes_the_weight_from_what_a_width_name_leaves() {
        assert_eq!(
            requested_face("Compressed Medium"),
            face(500.0, false, 0.625)
        );
        assert_eq!(
            requested_face("Condensed Bold Italic"),
            face(700.0, true, 0.75)
        );
        assert_eq!(
            requested_face("Extra Condensed Light"),
            face(300.0, false, 0.625)
        );
        assert_eq!(
            requested_face("SemiBold SemiCondensed"),
            face(600.0, false, 0.875)
        );
    }

    #[test]
    fn names_the_families_windows_registers_a_face_under() {
        assert_eq!(
            legacy_family_names("Acme", "Compressed Medium Italic"),
            ["Acme Compressed Medium"]
        );
        assert_eq!(
            legacy_family_names("Acme", "Compressed Bold Italic"),
            ["Acme Compressed Bold", "Acme Compressed"]
        );
        assert_eq!(legacy_family_names("Acme", "Bold Italic"), ["Acme Bold"]);
        assert!(legacy_family_names("Acme", "Italic").is_empty());
    }

    #[test]
    fn tells_styles_of_weight_and_slant_from_ones_naming_more() {
        assert!(names_only_weight_and_slant("Regular"));
        assert!(names_only_weight_and_slant("Bold Italic"));
        assert!(names_only_weight_and_slant("italic"));
        assert!(names_only_weight_and_slant("Medium"));
        assert!(names_only_weight_and_slant("SemiBold Italic"));
        assert!(names_only_weight_and_slant("Light"));
        assert!(names_only_weight_and_slant("Book"));
        assert!(names_only_weight_and_slant("500"));
        assert!(!names_only_weight_and_slant("Compressed Bold"));
        assert!(!names_only_weight_and_slant("Condensed"));
        assert!(!names_only_weight_and_slant("Display Medium"));
        assert!(!names_only_weight_and_slant("550"));
    }

    #[test]
    fn names_faces_by_the_nearest_weight() {
        assert_eq!(style_name(400.0, false), "Regular");
        assert_eq!(style_name(450.0, false), "Regular");
        assert_eq!(style_name(510.0, false), "Medium");
        assert_eq!(style_name(700.0, true), "Bold Italic");
    }

    #[test]
    fn lists_every_named_weight_a_variable_face_covers() {
        assert_eq!(face_styles(510.0, false, None), ["Medium"]);
        assert_eq!(
            face_styles(400.0, true, Some((350.0, 700.0))),
            [
                "Regular Italic",
                "Medium Italic",
                "SemiBold Italic",
                "Bold Italic"
            ]
        );
    }
}
