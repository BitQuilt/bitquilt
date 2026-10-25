"""BitQuilt core, version 1: a second implementation in Python from CORE.md
and the conformance fixtures alone.

    state = reduce(envelopes, blobs, receipts, now)
    pick = next(state, key, client, now)
"""

from .canonical import canonical, canonical_bytes
from .hashes import hash_json, hash_bytes, keccak256
from .identity import signer_of, address_of, checksum_address
from .envelope import problem_hash, expand, piece_hash, validate_envelope, EnvelopeError
from .reducer import reduce, State, Piece
from .picker import next_piece as next

__all__ = [
    "canonical", "canonical_bytes", "hash_json", "hash_bytes", "keccak256",
    "signer_of", "address_of", "checksum_address",
    "problem_hash", "expand", "piece_hash", "validate_envelope", "EnvelopeError",
    "reduce", "State", "Piece", "next",
]
