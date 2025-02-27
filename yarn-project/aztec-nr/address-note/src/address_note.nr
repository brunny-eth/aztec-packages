use dep::aztec::note::note_interface::NoteInterface;
use dep::aztec::note::note_header::NoteHeader;
use dep::aztec::note::utils::compute_siloed_note_hash;
use dep::aztec::oracle::get_secret_key::get_secret_key;

global ADDRESS_NOTE_LEN: Field = 2;

// Stores an address
struct AddressNote {
    address: Field,
    owner: Field,
    header: NoteHeader,
}

impl AddressNote {
    pub fn new(address: Field, owner: Field) -> Self {
        AddressNote {
            address,
            owner,
            header: NoteHeader::empty(),
        }
    }

    pub fn serialize(self) -> [Field; ADDRESS_NOTE_LEN]{
        [self.address, self.owner]
    }

    pub fn compute_nullifier(self) -> Field {
        let siloed_note_hash = compute_siloed_note_hash(AddressNoteMethods, self);
        let secret = get_secret_key(self.owner);
        // TODO(#1205) Should use a non-zero generator index.
        dep::std::hash::pedersen([
            siloed_note_hash,
            secret.low,
            secret.high,
        ])[0]
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }
}

fn deserialize(preimage: [Field; ADDRESS_NOTE_LEN]) -> AddressNote {
    AddressNote {
        address: preimage[0],
        owner: preimage[1],
        header: NoteHeader::empty(),
    }
}

fn serialize(note: AddressNote) -> [Field; ADDRESS_NOTE_LEN]{
    note.serialize()
}

fn compute_note_hash(note: AddressNote) -> Field {
    // TODO(#1205) Should use a non-zero generator index.
    dep::std::hash::pedersen(note.serialize())[0]
}

fn compute_nullifier(note: AddressNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: AddressNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut AddressNote, header: NoteHeader) {
    note.set_header(header);
}

global AddressNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
};
