//! Byte-level knowledge of OpenType font files, independent of how fonts are discovered.

use std::io::{Read, Seek, SeekFrom};

const TTC_TAG: &[u8; 4] = b"ttcf";
const OUTLINE_TABLES: [&[u8; 4]; 3] = [b"glyf", b"CFF ", b"CFF2"];
const NAME_TAG: &[u8; 4] = b"name";
const FULL_NAME_ID: u16 = 4;
const POSTSCRIPT_NAME_ID: u16 = 6;
const NAME_RECORD_SIZE: usize = 12;
const OFFSET_TABLE_SIZE: usize = 12;
const TABLE_RECORD_SIZE: usize = 16;

fn read_array<const N: usize>(reader: &mut impl Read) -> Option<[u8; N]> {
    let mut bytes = [0; N];
    reader.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        data.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        data.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

/// Returns font data whose first table directory is face `index`, which renderers that read only
/// the first face of a collection (CanvasKit) accept. Table offsets in a collection are absolute,
/// so the tables themselves stay where they are.
pub fn standalone_face(data: &[u8], index: u32) -> Option<Vec<u8>> {
    if data.get(0..4)? != TTC_TAG {
        return (index == 0).then(|| data.to_vec());
    }
    let count = read_u32(data, 8)?;
    if index >= count {
        return None;
    }
    let face = read_u32(data, OFFSET_TABLE_SIZE + 4 * index as usize)? as usize;
    let num_tables = read_u16(data, face + 4)? as usize;
    let directory = OFFSET_TABLE_SIZE + num_tables * TABLE_RECORD_SIZE;
    let mut standalone = data.to_vec();
    standalone
        .get_mut(..directory)?
        .copy_from_slice(data.get(face..face + directory)?);
    Some(standalone)
}

/// Returns whether every face in a font file stores outlines only in a table the renderer cannot
/// draw, such as Apple's `hvgl` (PingFang on macOS 15 and later). Reads only the table directories.
pub fn has_only_unsupported_outlines(reader: &mut (impl Read + Seek)) -> Option<bool> {
    let header: [u8; 12] = read_array(reader)?;
    let face_offsets = if &header[0..4] == TTC_TAG {
        let count = u32::from_be_bytes(header[8..12].try_into().ok()?);
        (0..count)
            .map(|_| read_array::<4>(reader).map(|offset| u32::from_be_bytes(offset) as u64))
            .collect::<Option<Vec<_>>>()?
    } else {
        vec![0]
    };
    for offset in face_offsets {
        reader.seek(SeekFrom::Start(offset + 4)).ok()?;
        let num_tables = u16::from_be_bytes(read_array(reader)?);
        reader.seek(SeekFrom::Current(6)).ok()?;
        let mut tags = Vec::with_capacity(num_tables as usize);
        for _ in 0..num_tables {
            let record: [u8; 16] = read_array(reader)?;
            tags.push([record[0], record[1], record[2], record[3]]);
        }
        let drawable = tags.iter().any(|tag| OUTLINE_TABLES.contains(&tag));
        if drawable || !tags.contains(b"hvgl") {
            return Some(false);
        }
    }
    Some(true)
}

fn face_offset(reader: &mut (impl Read + Seek), index: u32) -> Option<u64> {
    let header: [u8; 12] = read_array(reader)?;
    if &header[0..4] != TTC_TAG {
        return (index == 0).then_some(0);
    }
    if index >= u32::from_be_bytes(header[8..12].try_into().ok()?) {
        return None;
    }
    reader
        .seek(SeekFrom::Start(
            (OFFSET_TABLE_SIZE + 4 * index as usize) as u64,
        ))
        .ok()?;
    Some(u32::from_be_bytes(read_array(reader)?) as u64)
}

fn name_table(reader: &mut (impl Read + Seek), face: u64) -> Option<Vec<u8>> {
    reader.seek(SeekFrom::Start(face + 4)).ok()?;
    let num_tables = u16::from_be_bytes(read_array(reader)?);
    reader.seek(SeekFrom::Current(6)).ok()?;
    for _ in 0..num_tables {
        let record: [u8; 16] = read_array(reader)?;
        if &record[0..4] == NAME_TAG {
            let offset = u32::from_be_bytes(record[8..12].try_into().ok()?);
            let length = u32::from_be_bytes(record[12..16].try_into().ok()?);
            reader.seek(SeekFrom::Start(offset as u64)).ok()?;
            let mut table = Vec::new();
            reader
                .take(u64::from(length))
                .read_to_end(&mut table)
                .ok()?;
            return (table.len() == length as usize).then_some(table);
        }
    }
    None
}

fn decode_name(platform: u16, encoding: u16, bytes: &[u8]) -> Option<String> {
    match (platform, encoding) {
        (0, _) | (3, 0) | (3, 1) | (3, 10) => {
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16(&units).ok()
        }
        (1, 0) => bytes
            .is_ascii()
            .then(|| bytes.iter().map(|&byte| char::from(byte)).collect()),
        _ => None,
    }
}

fn face_name_of_record(table: &[u8], storage: usize, record: usize) -> Option<String> {
    let at = 6 + record * NAME_RECORD_SIZE;
    let name_id = read_u16(table, at + 6)?;
    if name_id != FULL_NAME_ID && name_id != POSTSCRIPT_NAME_ID {
        return None;
    }
    let length = read_u16(table, at + 8)? as usize;
    let start = storage + read_u16(table, at + 10)? as usize;
    let bytes = table.get(start..start + length)?;
    decode_name(read_u16(table, at)?, read_u16(table, at + 2)?, bytes)
}

pub fn face_names(reader: &mut (impl Read + Seek), index: u32) -> Option<Vec<String>> {
    let face = face_offset(reader, index)?;
    let table = name_table(reader, face)?;
    let count = read_u16(&table, 2)? as usize;
    let storage = read_u16(&table, 4)? as usize;
    let mut names: Vec<String> = Vec::new();
    for name in (0..count).filter_map(|record| face_name_of_record(&table, storage, record)) {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    Some(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn face(tags: &[&[u8; 4]]) -> Vec<u8> {
        let mut data = 0x0001_0000u32.to_be_bytes().to_vec();
        data.extend((tags.len() as u16).to_be_bytes());
        data.extend([0; 6]);
        for tag in tags {
            data.extend(*tag);
            data.extend([0; 12]);
        }
        data
    }

    fn collection(faces: &[Vec<u8>]) -> Vec<u8> {
        let mut data = TTC_TAG.to_vec();
        data.extend(0x0001_0000u32.to_be_bytes());
        data.extend((faces.len() as u32).to_be_bytes());
        let mut offset = 12 + faces.len() * 4;
        for face in faces {
            data.extend((offset as u32).to_be_bytes());
            offset += face.len();
        }
        faces.iter().for_each(|face| data.extend(face));
        data
    }

    fn check(data: Vec<u8>) -> Option<bool> {
        has_only_unsupported_outlines(&mut Cursor::new(data))
    }

    #[test]
    fn detects_collections_with_only_hvgl_outlines() {
        let hvgl = face(&[b"cmap", b"fvar", b"hvgl", b"name"]);
        assert_eq!(check(collection(&[hvgl.clone(), hvgl])), Some(true));
    }

    #[test]
    fn accepts_fonts_with_drawable_outlines() {
        assert_eq!(check(face(&[b"cmap", b"glyf", b"loca"])), Some(false));
        assert_eq!(check(face(&[b"CFF ", b"cmap"])), Some(false));
        let mixed = collection(&[face(&[b"hvgl"]), face(&[b"CFF2"])]);
        assert_eq!(check(mixed), Some(false));
    }

    #[test]
    fn ignores_truncated_data() {
        assert_eq!(check(vec![0; 6]), None);
        let mut truncated = face(&[b"hvgl", b"cmap"]);
        truncated.truncate(20);
        assert_eq!(check(truncated), None);
    }

    #[test]
    fn moves_the_requested_face_to_the_front_of_a_collection() {
        let first = face(&[b"cmap", b"glyf"]);
        let second = face(&[b"CFF ", b"name", b"OS/2"]);
        let data = collection(&[first, second.clone()]);

        let standalone = standalone_face(&data, 1).unwrap();
        assert_eq!(standalone.len(), data.len());
        assert_eq!(&standalone[..second.len()], &second[..]);
        assert_eq!(standalone_face(&data, 2), None);
    }

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_be_bytes).collect()
    }

    fn named_face(records: &[(u16, u16, &[u8])]) -> Vec<u8> {
        let storage_offset = 6 + records.len() * NAME_RECORD_SIZE;
        let mut table = 0u16.to_be_bytes().to_vec();
        table.extend((records.len() as u16).to_be_bytes());
        table.extend((storage_offset as u16).to_be_bytes());
        let mut storage: Vec<u8> = Vec::new();
        for (platform, name_id, bytes) in records {
            let encoding = u16::from(*platform == 3);
            for field in [*platform, encoding, 0x409, *name_id, bytes.len() as u16] {
                table.extend(field.to_be_bytes());
            }
            table.extend((storage.len() as u16).to_be_bytes());
            storage.extend(*bytes);
        }
        table.extend(storage);
        let mut data = 0x0001_0000u32.to_be_bytes().to_vec();
        data.extend(1u16.to_be_bytes());
        data.extend([0; 6]);
        data.extend(NAME_TAG);
        data.extend([0; 4]);
        data.extend(((OFFSET_TABLE_SIZE + TABLE_RECORD_SIZE) as u32).to_be_bytes());
        data.extend((table.len() as u32).to_be_bytes());
        data.extend(table);
        data
    }

    #[test]
    fn reads_the_full_and_postscript_names() {
        let full = utf16("Acme Sans Compressed Medium");
        let postscript = utf16("AcmeSans-CompressedMedium");
        let family = utf16("Acme Sans");
        let data = named_face(&[(3, 1, &family), (3, 4, &full), (3, 6, &postscript)]);

        assert_eq!(
            face_names(&mut Cursor::new(&data), 0),
            Some(vec![
                "Acme Sans Compressed Medium".to_string(),
                "AcmeSans-CompressedMedium".to_string()
            ])
        );
        assert_eq!(face_names(&mut Cursor::new(&data), 1), None);
    }

    #[test]
    fn reads_ascii_mac_roman_names_and_rejects_a_truncated_table() {
        let data = named_face(&[(1, 6, b"AcmeSans-Bold")]);
        assert_eq!(
            face_names(&mut Cursor::new(&data), 0),
            Some(vec!["AcmeSans-Bold".to_string()])
        );
        let accented = named_face(&[(1, 4, &b"Acme Caf\x8e"[..]), (1, 6, &b"Acme-Cafe"[..])]);
        assert_eq!(
            face_names(&mut Cursor::new(&accented), 0),
            Some(vec!["Acme-Cafe".to_string()])
        );
        let mut truncated = data.clone();
        truncated.truncate(data.len() - 4);
        assert_eq!(face_names(&mut Cursor::new(&truncated), 0), None);
    }

    #[test]
    fn keeps_the_names_before_a_truncated_record() {
        let mut data = named_face(&[(3, 6, &utf16("Foo-Bold"))]);
        let count_at = OFFSET_TABLE_SIZE + TABLE_RECORD_SIZE + 2;
        data[count_at..count_at + 2].copy_from_slice(&u16::MAX.to_be_bytes());
        assert_eq!(
            face_names(&mut Cursor::new(&data), 0),
            Some(vec!["Foo-Bold".to_string()])
        );
    }

    #[test]
    fn rejects_a_name_table_longer_than_the_file() {
        let mut data = named_face(&[(3, 6, &utf16("Foo-Bold"))]);
        let length_at = OFFSET_TABLE_SIZE + 12;
        data[length_at..length_at + 4].copy_from_slice(&u32::MAX.to_be_bytes());
        assert_eq!(face_names(&mut Cursor::new(&data), 0), None);
    }

    #[test]
    fn keeps_single_fonts_unchanged() {
        let single = face(&[b"cmap", b"glyf"]);
        assert_eq!(standalone_face(&single, 0), Some(single.clone()));
        assert_eq!(standalone_face(&single, 1), None);
    }
}
