"""Generalization proof: run the detection stack on an UNSEEN synthetic document.

Everything here is new to the detector - different people, a different company, a different
city, all synthetic. If the detector only worked by memorizing the Cadence corpus, this would
fail. It passes because detection relies on general rules, not a hard-coded name list.

Run:  python test_generalize.py
"""
import re
import detect as D
import spacy

nlp = spacy.load("en_core_web_sm")

# A document the system has never seen. New names, new company, new cities, synthetic PII.
DOC = """Quarterly vendor review, prepared by Brighthaven Logistics for the Rotterdam office.

The account is managed by Gabriel Okafor, who can be reached at g.okafor@brighthaven.com or on
+1 (415) 555 0182. His colleague Lars Andersson (SSN 123-45-6789) handles escalations, with
oversight from Yuki Tanaka at the Nagoya branch. Zephyr Analytics Ltd supplies the model, and
payments route through card 4539 1488 0343 6467.
"""

spans = D.resolve_overlaps(
    D.regex_spans(DOC) + D.person_spans_pattern(DOC) + D.person_spans_ner(nlp, DOC)
)
found = {}
for a, b, cat, conf, rule in spans:
    found.setdefault(cat, []).append(re.sub(r"\s+", " ", DOC[a:b]).strip())

print("=== PII detected in the unseen document ===")
for cat, vals in sorted(found.items()):
    print(f"  {cat:12} {vals}")

people = found.get("PERSON", [])
PASS = FAIL = 0


def check(cond, label):
    global PASS, FAIL
    PASS, FAIL = (PASS + 1, FAIL) if cond else (PASS, FAIL + 1)
    if not cond:
        print(f"  FAIL: {label}")


print("\n=== checks ===")
# new people are caught
for surname in ("Okafor", "Andersson", "Tanaka"):
    check(any(surname in p for p in people), f"new person caught: ...{surname}")
# new structured PII is caught
check("EMAIL" in found, "new-domain email caught")
check("PHONE" in found, "new phone caught")
check("SSN" in found, "SSN caught")
check("CARD_NUMBER" in found, "card caught (Luhn)")
# the new company and cities are NOT mistaken for people (the de-overfit payoff)
for notperson in ("Brighthaven", "Logistics", "Zephyr", "Analytics", "Rotterdam", "Nagoya"):
    check(not any(notperson in p for p in people), f"not mistaken for a person: {notperson}")

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
