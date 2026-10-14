"""Independent check of numeric final answers with SymPy, so maths marks never depend on the LLM alone."""

import re

from sympy import N, nsimplify
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)
_UNIT = re.compile(r"[a-zA-Z°%/\s²³]+$")


def _to_number(text: str):
    t = text.strip().replace("×", "*").replace("÷", "/").replace("−", "-").replace(",", "")
    t = t.split("=")[-1].strip()
    t = _UNIT.sub("", t).strip()
    if not t:
        return None
    try:
        return N(nsimplify(parse_expr(t, transformations=_TRANSFORMS)))
    except Exception:
        return None


def same_value(student: str | None, expected: str | None, rel_tol: float = 0.01) -> bool | None:
    """True/False when both sides are numbers, None when the answers are not numeric."""
    if not student or not expected:
        return None
    a, b = _to_number(student), _to_number(expected)
    if a is None or b is None:
        return None
    try:
        a, b = float(a), float(b)
    except TypeError:
        return None
    if b == 0:
        return abs(a) < 1e-9
    return abs(a - b) / abs(b) <= rel_tol
