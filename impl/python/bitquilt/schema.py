"""The closed schema of CORE.md section 2, and validation of a return against it.

"A schema is a closed object: `"type": "object"`, `"additionalProperties":
false`, a `required` list, and `properties` each of which is one of:
`{ "type": "string", "maxLength", "minLength"?, "format"?: "date" }`, with
lengths counted in Unicode scalar values; `{ "type": "number" | "integer",
"tolerance"?: number }`, the tolerance absolute, in the field's own units;
`{ "type": "boolean" }`; `{ "enum": [strings] }`; or `{ "type": "array",
"maxItems", "items": one of the above }`. Nothing else."
"""

from datetime import date


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def schema_problems(schema) -> list:
    """Why a schema is not one the core allows; empty when it is."""
    out = []
    if not isinstance(schema, dict):
        return ["schema is not an object"]
    if schema.get("type") != "object":
        out.append("schema.type is not object")
    if schema.get("additionalProperties") is not False:
        out.append("schema.additionalProperties is not false")
    required = schema.get("required")
    props = schema.get("properties")
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        out.append("schema.required is not a list of names")
    if not isinstance(props, dict):
        out.append("schema.properties is not an object")
        return out
    allowed = {"type", "additionalProperties", "required", "properties"}
    for k in schema:
        if k not in allowed:
            out.append("schema has %s" % k)
    for name, prop in props.items():
        out.extend("schema.properties.%s: %s" % (name, why) for why in _property_problems(prop, nested=False))
    if isinstance(required, list):
        for r in required:
            if r not in props:
                out.append("schema.required names %s, which properties lacks" % r)
    return out


def _property_problems(prop, nested) -> list:
    if not isinstance(prop, dict):
        return ["not an object"]
    keys = set(prop)
    if "enum" in prop:
        if keys != {"enum"}:
            return ["enum with other keywords"]
        if not isinstance(prop["enum"], list) or not prop["enum"] or not all(isinstance(e, str) for e in prop["enum"]):
            return ["enum is not a list of strings"]
        return []
    t = prop.get("type")
    if t == "string":
        if not keys <= {"type", "maxLength", "minLength", "format"}:
            return ["string with other keywords"]
        if not isinstance(prop.get("maxLength"), int) or prop["maxLength"] < 0:
            return ["string without maxLength"]
        if "minLength" in prop and (not isinstance(prop["minLength"], int) or prop["minLength"] < 0):
            return ["minLength is not a count"]
        if "format" in prop and prop["format"] != "date":
            return ["format other than date"]
        return []
    if t in ("number", "integer"):
        if not keys <= {"type", "tolerance"}:
            return ["number with other keywords"]
        if "tolerance" in prop and (not _is_number(prop["tolerance"]) or prop["tolerance"] < 0):
            return ["tolerance is not a number"]
        return []
    if t == "boolean":
        if keys != {"type"}:
            return ["boolean with other keywords"]
        return []
    if t == "array":
        if nested:
            return ["array inside an array"]
        if not keys <= {"type", "maxItems", "items"}:
            return ["array with other keywords"]
        if not isinstance(prop.get("maxItems"), int) or prop["maxItems"] < 0:
            return ["array without maxItems"]
        return ["items: %s" % why for why in _property_problems(prop.get("items"), nested=True)]
    return ["type is not one the core defines"]


def _is_date(s: str) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def validate_return(ret, schema, path="return") -> list:
    """Why a return fails its schema; empty when it validates."""
    out = []
    if not isinstance(ret, dict):
        return ["%s: not an object" % path]
    props = schema.get("properties", {})
    for name in schema.get("required", []):
        if name not in ret:
            out.append("%s.%s: required" % (path, name))
    for name, value in ret.items():
        if name not in props:
            out.append("%s.%s: not a property of the schema" % (path, name))
            continue
        out.extend(_validate_value(value, props[name], "%s.%s" % (path, name)))
    return out


def _validate_value(value, prop, path) -> list:
    if "enum" in prop:
        if value not in prop["enum"] or not isinstance(value, str):
            return ["%s: one of %s" % (path, ", ".join(prop["enum"]))]
        return []
    t = prop.get("type")
    if t == "string":
        if not isinstance(value, str):
            return ["%s: a string" % path]
        n = len(value)  # Python strings are sequences of scalar values
        if n > prop["maxLength"]:
            return ["%s: at most %d characters" % (path, prop["maxLength"])]
        if n < prop.get("minLength", 0):
            return ["%s: at least %d characters" % (path, prop["minLength"])]
        if prop.get("format") == "date" and not _is_date(value):
            return ["%s: a date" % path]
        return []
    if t == "number":
        if not _is_number(value):
            return ["%s: a number" % path]
        return []
    if t == "integer":
        if not _is_number(value) or (isinstance(value, float) and not value.is_integer()):
            return ["%s: an integer" % path]
        return []
    if t == "boolean":
        if not isinstance(value, bool):
            return ["%s: a boolean" % path]
        return []
    if t == "array":
        if not isinstance(value, list):
            return ["%s: an array" % path]
        if len(value) > prop["maxItems"]:
            return ["%s: at most %d items" % (path, prop["maxItems"])]
        out = []
        for i, item in enumerate(value):
            out.extend(_validate_value(item, prop["items"], "%s[%d]" % (path, i)))
        return out
    return ["%s: schema type unknown" % path]
