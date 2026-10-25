"""Hashes: SHA-256 in the core's `sha256:` form, and Keccak-256 for addresses.

CORE.md section 1: "A hash is `sha256:` and the lower-case hex of SHA-256 over
those bytes, or over the bytes of a blob."

Keccak-256 is not SHA3-256 (the padding differs), and hashlib has only the
latter, so it is written out here. Standard library only.
"""

import hashlib

from .canonical import canonical_bytes


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_bytes(data: bytes) -> str:
    """`sha256:` and the hex of SHA-256 over raw bytes (a blob)."""
    return "sha256:" + sha256_hex(data)


def hash_json(value) -> str:
    """`sha256:` and the hex of SHA-256 over the canonical JSON of a value."""
    return hash_bytes(canonical_bytes(value))


# Keccak-f[1600] round constants and rotation offsets.
_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]
_MASK = (1 << 64) - 1


def _rol(x, n):
    n %= 64
    return ((x << n) | (x >> (64 - n))) & _MASK if n else x


def _keccak_f(a):
    for rc in _RC:
        # theta
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        a = [[a[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        # rho and pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        # chi
        a = [[b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        # iota
        a[0][0] ^= rc
    return a


def keccak256(data: bytes) -> bytes:
    rate = 136  # bytes, for a 256-bit output
    # pad10*1 with the Keccak domain byte 0x01
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % rate:
        padded.append(0x00)
    padded[-1] |= 0x80
    state = [[0] * 5 for _ in range(5)]
    for off in range(0, len(padded), rate):
        block = padded[off:off + rate]
        for i in range(rate // 8):
            lane = int.from_bytes(block[8 * i:8 * i + 8], "little")
            x, y = i % 5, i // 5
            state[x][y] ^= lane
        state = _keccak_f(state)
    out = bytearray()
    for i in range(4):
        x, y = i % 5, i // 5
        out += state[x][y].to_bytes(8, "little")
    return bytes(out)
