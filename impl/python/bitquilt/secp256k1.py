"""secp256k1 public-key recovery from a recoverable ECDSA signature.

Standard library only: affine arithmetic over the field with pow(x, -1, p)
for inverses. Slow by a library's standards, fast enough for a ledger.
"""

P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
G = (GX, GY)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1) * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    y3 = (lam * (x1 - x3) - y1) % P
    return (x3, y3)


def _mul(k, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _add(result, addend)
        addend = _add(addend, addend)
        k >>= 1
    return result


def _lift_x(x, odd):
    y2 = (pow(x, 3, P) + 7) % P
    y = pow(y2, (P + 1) // 4, P)
    if (y * y) % P != y2:
        return None
    if (y & 1) != odd:
        y = P - y
    return (x, y)


def recover(digest: bytes, r: int, s: int, recid: int):
    """The public key (x, y) that signed `digest`, or None.

    `recid` is 0..3: bit 0 is the parity of R's y, bit 1 says R's x
    overflowed the group order.
    """
    if not (1 <= r < N and 1 <= s < N and 0 <= recid <= 3):
        return None
    x = r + (N if recid & 2 else 0)
    if x >= P:
        return None
    R = _lift_x(x, recid & 1)
    if R is None or _mul(N, R) is not None:
        return None
    z = int.from_bytes(digest, "big")
    r_inv = pow(r, -1, N)
    sR = _mul(s, R)
    zG = _mul((N - z) % N, G)
    Q = _mul(r_inv, _add(sR, zG))
    return Q


def pubkey_bytes(Q) -> bytes:
    """The uncompressed public key without its 0x04 prefix: x || y, 64 bytes."""
    return Q[0].to_bytes(32, "big") + Q[1].to_bytes(32, "big")
