"""Identities and signatures.

CORE.md section 1:
- "A key is secp256k1. An identity is the key's Ethereum address with the
  EIP-55 checksum."
- "A signature is a recoverable ECDSA signature in the EIP-191
  personal-message form over the canonical JSON of the object without its
  `sig` field (and without `sig_to`, where there is one). The address
  recovered from it is the signer and is compared with the object's `key`
  or `owner` field."
"""

from .canonical import canonical_bytes
from .hashes import keccak256
from . import secp256k1


def checksum_address(addr_bytes: bytes) -> str:
    """EIP-55: the hex of the address with letters capitalised by its keccak."""
    hex_lower = addr_bytes.hex()
    digest = keccak256(hex_lower.encode("ascii")).hex()
    out = []
    for ch, h in zip(hex_lower, digest):
        out.append(ch.upper() if ch.isalpha() and int(h, 16) >= 8 else ch)
    return "0x" + "".join(out)


def address_of(Q) -> str:
    """The checksummed address of a public key: the last twenty bytes of
    keccak-256 over the uncompressed key."""
    return checksum_address(keccak256(secp256k1.pubkey_bytes(Q))[-20:])


def personal_message_digest(message: bytes) -> bytes:
    """EIP-191 version 0x45: keccak256("\\x19Ethereum Signed Message:\\n" + len + message)."""
    prefix = b"\x19Ethereum Signed Message:\n" + str(len(message)).encode("ascii")
    return keccak256(prefix + message)


def recover_signer(message: bytes, sig_hex: str):
    """The address that produced `sig_hex` over `message`, or None."""
    if not isinstance(sig_hex, str) or not sig_hex.startswith("0x"):
        return None
    try:
        sig = bytes.fromhex(sig_hex[2:])
    except ValueError:
        return None
    if len(sig) != 65:
        return None
    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:64], "big")
    v = sig[64]
    if v >= 27:
        v -= 27
    if v > 3:
        return None
    Q = secp256k1.recover(personal_message_digest(message), r, s, v)
    if Q is None:
        return None
    return address_of(Q)


def signed_body(obj: dict) -> dict:
    """The object without `sig` and `sig_to`: what a signature covers."""
    return {k: v for k, v in obj.items() if k not in ("sig", "sig_to")}


def signer_of(obj: dict, field: str = "sig"):
    """The address recovered from `obj[field]` over the object without its
    signatures, or None when the signature does not parse or recover."""
    sig = obj.get(field)
    if sig is None:
        return None
    return recover_signer(canonical_bytes(signed_body(obj)), sig)


def same_address(a, b) -> bool:
    return isinstance(a, str) and isinstance(b, str) and a.lower() == b.lower()
