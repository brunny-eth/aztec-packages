use dep::aztec::note::{
    note_header::NoteHeader,
    note_interface::NoteInterface,
    utils::compute_note_hash_for_read_or_nullify,
};
use dep::aztec::oracle::{
    get_secret_key::get_secret_key,
};

global CARD_NOTE_LEN: Field = 3;

// docs:start:state_vars-CardNote
struct CardNote {
    points: u8,
    secret: Field,
    owner: Field,
    header: NoteHeader,
}
// docs:end:state_vars-CardNote

impl CardNote {
    pub fn new(points: u8, secret: Field, owner: Field) -> Self {
        CardNote {
            points,
            secret,
            owner,
            header: NoteHeader::empty(),
        }
    }

    pub fn serialize(self) -> [Field; CARD_NOTE_LEN] {
        [self.points as Field, self.secret, self.owner]
    }

    pub fn deserialize(preimage: [Field; CARD_NOTE_LEN]) -> Self {
        CardNote {
            points: preimage[0] as u8,
            secret: preimage[1],
            owner: preimage[2],
            header: NoteHeader::empty(),
        }
    }

    pub fn compute_note_hash(self) -> Field {
        dep::std::hash::pedersen([
            self.points as Field, 
            self.secret,
            self.owner,
        ])[0]
    }

    pub fn compute_nullifier(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(CardNoteMethods, self);
        let secret = get_secret_key(self.owner);
        dep::std::hash::pedersen([
            note_hash_for_nullify,
            secret.high,
            secret.low,
        ])[0]
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }
}

fn deserialize(preimage: [Field; CARD_NOTE_LEN]) -> CardNote {
    CardNote::deserialize(preimage)
}

fn serialize(note: CardNote) -> [Field; CARD_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: CardNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: CardNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: CardNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut CardNote, header: NoteHeader) {
    note.set_header(header)
}

global CardNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
};
