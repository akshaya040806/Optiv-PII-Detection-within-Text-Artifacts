"""Fast, OCR-free self-checks for the detection layer (detect.py).

Locks in the checksum validators and every leak/false-positive we fixed, so a future
edit can't silently reintroduce them. Run:  python test_detect.py
"""
import re
import detect as D

PASS = FAIL = 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL: {label}")


def cats(text):
    return {c for _, _, c, _, _ in D.regex_spans(text)}


def persons(text):
    return [text[a:b] for a, b, c, _, _ in D.regex_spans(text) + D.person_spans_pattern(text) if c == "PERSON"]


# --- checksums -------------------------------------------------------------
check(D.luhn_ok("4111111111111111"), "Luhn accepts a valid card")
check(not D.luhn_ok("4111111111111112"), "Luhn rejects a bad card")
check(D.pesel_ok("44051401458"), "PESEL accepts a valid checksum")
check(not D.pesel_ok("44051401459"), "PESEL rejects a bad checksum")
check(D.ssn_valid_range("123-45-6789"), "SSN range accepts a valid SSN")
check(not D.ssn_valid_range("900-55-2043"), "SSN range rejects a 9xx test SSN")

# --- structured identifiers ------------------------------------------------
check("EMAIL" in cats("contact jane.doe@example.com please"), "plain email detected")
check("EMAIL" in cats("board.chair@cadencefg.com"), "role mailbox now redacted (not suppressed)")
check("EMAIL" in cats("owned by N. Osadebe (n.osadebe @cadencefg.com)"), "OCR-split email detected")
check("EMAIL" not in cats("let's meet @ 5pm today"), "ordinary '@' text is not an email")
check("PAN_IN" in cats("PAN AQBPR7741L on file"), "India PAN detected")
check("SSN" in cats("SSN: 900-55-2043"), "SSN detected via keyword context")

# --- international IDs (checksum-validated) ---
check(D.iban_ok("GB82 WEST 1234 5698 7654 32"), "IBAN accepts a valid IBAN")
check(not D.iban_ok("GB82 WEST 1234 5698 7654 33"), "IBAN rejects a bad checksum")
check(D.verhoeff_ok("2363"), "Verhoeff accepts a valid number")
check(not D.verhoeff_ok("2364"), "Verhoeff rejects a bad number")
check(D.nhs_ok("9434765919"), "NHS accepts a valid number")
check(not D.nhs_ok("9434765918"), "NHS rejects a bad checksum")
check("IBAN" in cats("transfer to GB82 WEST 1234 5698 7654 32 today"), "IBAN detected")
_aad = next(b for b in ("2345 6789 012" + c for c in "0123456789") if D.verhoeff_ok(re.sub(r"\D", "", b)))
check("AADHAAR" in cats("Aadhaar " + _aad), "Aadhaar detected (Verhoeff)")
check("NHS_NUMBER" in cats("NHS No 943 476 5919"), "NHS number detected (mod-11)")
check("NINO" in cats("NINO: AB 12 34 56 C"), "UK NINO detected")
check("IBAN" not in cats("order GB00 WEST 1234 5698 7654 32 shipped"), "bad-checksum IBAN not detected")

# --- phones (incl. the formats that leaked) --------------------------------
check("PHONE" in cats("mobile +1 (555) 0139"), "area-code + single group phone detected")
check("PHONE" in cats("20 7555 0129"), "OCR-wrapped whole-segment phone detected")
check("PHONE" not in cats("ISS-2026-0112"), "year-prefixed ref id is not a phone")

# --- person names (the ones that leaked, now caught) -----------------------
for name in ("H. Park", "KC Burney", "Erik Hansen", "Mark Read", "Skylar Damiano"):
    check(any(name.split()[-1] in p for p in persons(name)), f"name detected: {name}")

# --- person false positives (must NOT be tagged people) --------------------
for phrase in ("AI Adoption", "VP Data", "Risk Management", "Breach Response", "Global Technology"):
    check(not persons(phrase), f"not a person: {phrase}")

# --- de-overfit: a company/city is no longer hard-coded in the stop list ---
check("Meridian" not in D.NAME_STOP and "Mumbai" not in D.NAME_STOP,
      "NAME_STOP no longer hard-codes corpus-specific company/city names")

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
