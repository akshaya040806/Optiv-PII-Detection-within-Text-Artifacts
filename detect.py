import re

# PII detection rules: patterns, checksums, context words, name heuristics
MONTHS = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE = rf"(?:\d{{1,2}}[/.-]\d{{1,2}}[/.-]\d{{4}}|\d{{1,2}}\s+{MONTHS}\s+\d{{4}}|{MONTHS}\s+\d{{1,2}},?\s+\d{{4}})"

FUNCTIONAL_MAILBOXES = {"board", "brc", "gerc", "orc", "remco", "vendor.ops", "board.chair"}

# Category -> sensitivity tier (drives masking + review routing)
TIER = {
    "SSN": "Critical", "SSN_PARTIAL": "High", "PASSPORT": "Critical", "PAN_IN": "Critical",
    "PESEL": "Critical", "TIN": "Critical", "CARD_NUMBER": "Critical", "CARD_PARTIAL": "High",
    "ACCOUNT_PARTIAL": "High", "DOB": "High", "HOME_ADDRESS": "High", "PHONE": "Medium",
    "EMAIL": "Medium", "EMPLOYEE_ID": "Medium", "PERSON": "Medium", "IP_ADDRESS": "Medium",
    "MONETARY_TXN": "Medium", "PHOTO": "High", "CREDENTIAL_ID": "Medium",
    "IBAN": "Critical", "AADHAAR": "Critical", "NHS_NUMBER": "Critical", "NINO": "High",
}


def luhn_ok(digits):
    s, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        s += d
        alt = not alt
    return s % 10 == 0


def pesel_ok(d):
    if len(d) != 11 or not d.isdigit():
        return False
    w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    return (10 - sum(int(d[i]) * w[i] for i in range(10)) % 10) % 10 == int(d[10])


def ssn_valid_range(s):
    a, g, n = s.split("-")
    return not (a in ("000", "666") or a.startswith("9") or g == "00" or n == "0000")


def iban_ok(iban):
    iban = re.sub(r"\s", "", iban).upper()
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", iban):
        return False
    rot = iban[4:] + iban[:4]
    return int("".join(str(int(ch, 36)) for ch in rot)) % 97 == 1   # A->10 … Z->35, digits unchanged


# Verhoeff checksum (India Aadhaar)
_VH_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
         [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
         [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
_VH_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
         [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]


def verhoeff_ok(num):
    if not num.isdigit():
        return False
    c = 0
    for i, d in enumerate(reversed(num)):
        c = _VH_D[c][_VH_P[i % 8][int(d)]]
    return c == 0


def nhs_ok(d):
    if len(d) != 10 or not d.isdigit():
        return False
    chk = 11 - sum(int(d[i]) * (10 - i) for i in range(9)) % 11
    chk = 0 if chk == 11 else chk
    return chk != 10 and chk == int(d[9])


def _ctx(text, start, end, before=40, after=0):
    return text[max(0, start - before):start].lower() + " " + text[end:end + after].lower()


def regex_spans(text):
    out = []

    def add(m, cat, conf, rule, g=0):
        out.append((m.start(g), m.end(g), cat, conf, rule))

    for m in re.finditer(r"[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", text):
        local = m.group().split("@")[0].lower()
        # role mailboxes (board.chair@, brc@ ...) are organizational not personal, but they are still
        # contact details - redact them too, just tag them distinctly for the audit trail
        if local in FUNCTIONAL_MAILBOXES:
            add(m, "EMAIL", 0.9, "role-mailbox (organizational contact)")
        else:
            add(m, "EMAIL", 0.99, "email-pattern")
    # OCR sometimes splits the address around '@' ("n.osadebe @cadencefg.com"); require a space + a real TLD so
    # ordinary text ("meet @ 5pm") is not matched
    for m in re.finditer(r"[A-Za-z0-9][A-Za-z0-9._%+-]*\s+@\s*[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}", text):
        local = m.group().split("@")[0].strip().lower()
        add(m, "EMAIL", 0.85, "role-mailbox (ocr-split)" if local in FUNCTIONAL_MAILBOXES else "email-pattern (ocr-split @)")

    for m in re.finditer(r"\b(?:EMP|DIR)-\d{4,5}\b|\bMER-[A-Z]{2}-\d{4}\b", text):
        add(m, "EMPLOYEE_ID", 0.97, "employee/vendor-id-pattern")

    for m in re.finditer(r"\b\d{3}-\d{2}-\d{4}\b", text):
        c = _ctx(text, m.start(), m.end(), 25)
        if "ssn" in c or "social security" in c or ssn_valid_range(m.group()):
            rule = "ssn-pattern+context" if not ssn_valid_range(m.group()) else "ssn-pattern+valid-range"
            add(m, "SSN", 0.95, rule)
    for m in re.finditer(r"social security number[^0-9]{0,12}\((\d{4})\)", text, re.I):
        add(m, "SSN_PARTIAL", 0.9, "last-4+context", 1)

    for m in re.finditer(r"\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b", text):
        add(m, "PAN_IN", 0.95 if "pan" in _ctx(text, m.start(), m.end(), 12) else 0.8,
            "pan-structure+entity-char")

    for m in re.finditer(r"\b\d{11}\b", text):
        if pesel_ok(m.group()):
            add(m, "PESEL", 0.9, "pesel-checksum")
    for m in re.finditer(r"PESEL\s+(\d{6}[xX*]{5})", text):
        add(m, "PESEL", 0.85, "pesel-partial+keyword", 1)

    # IBAN (international bank account) — mod-97 checksum
    for m in re.finditer(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b", text):
        if iban_ok(m.group()):
            add(m, "IBAN", 0.97, "iban-mod97")
    # India Aadhaar — 12 digits (4-4-4), Verhoeff checksum + keyword. A spaced 12-digit run on its own is too
    # common (dates, phone fragments) to trust on the checksum alone, so require an aadhaar/uid label nearby.
    # The (?<!\d )/(?! \d) guards stop it matching a 12-digit slice inside a longer card/account number.
    for m in re.finditer(r"(?<!\d )\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b(?! \d)", text):
        c = _ctx(text, m.start(), m.end(), 20)
        if ("aadhaar" in c or "uid" in c) and verhoeff_ok(re.sub(r"\D", "", m.group())):
            add(m, "AADHAAR", 0.9, "aadhaar-verhoeff+keyword")
    # UK NHS number — 10 digits (3-3-4), mod-11 checksum + keyword (same reasoning: phone-like runs collide).
    for m in re.finditer(r"(?<!\d )\b\d{3}\s?\d{3}\s?\d{4}\b(?! \d)", text):
        c = _ctx(text, m.start(), m.end(), 20)
        if ("nhs" in c or "health" in c) and nhs_ok(re.sub(r"\D", "", m.group())):
            add(m, "NHS_NUMBER", 0.9, "nhs-mod11+keyword")
    # UK National Insurance Number — structure + valid prefix letters
    for m in re.finditer(r"\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b", text):
        add(m, "NINO", 0.9, "uk-nino-structure")

    for m in re.finditer(r"(?i:passport)[\s:#]*([A-Z]{1,2}\d{6,8})\b", text):
        add(m, "PASSPORT", 0.95, "passport-keyword", 1)

    for m in re.finditer(r"(?i:\b(?:TIN|tax id(?:entifier)?)\b)[\s:#]*(\d{2}-\d{7}|\d{9})\b", text):
        add(m, "TIN", 0.9, "tin-keyword", 1)

    for m in re.finditer(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])", text):
        d = re.sub(r"\D", "", m.group())
        if 13 <= len(d) <= 19 and luhn_ok(d) and not re.search(r"(\d)\1{6,}", d):
            add(m, "CARD_NUMBER", 0.9, "luhn")
    for m in re.finditer(r"\b\d{4}[- ][Xx*]{4}[- ][Xx*]{4}[- ]\d{4}\b", text):
        add(m, "CARD_PARTIAL", 0.85, "masked-card")
    for m in re.finditer(r"card ending (\d{4})", text, re.I):
        add(m, "CARD_PARTIAL", 0.9, "card-ending+context", 1)
    for m in re.finditer(r"account (?:ending|number|no\.?)\s*(\d{4,})", text, re.I):
        add(m, "ACCOUNT_PARTIAL", 0.9, "account+context", 1)

    for m in re.finditer(rf"(?i:\bDOB\b|date of birth|born(?: on)?)[\s:,]*({DATE})", text):
        add(m, "DOB", 0.95, "date+dob-keyword", 1)

    street = r"(?:Street|St|Lane|Ln|Court|Ct|Crescent|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Place)"
    for m in re.finditer(rf"\b\d{{1,5}}\s+(?:[A-Z][a-z]+\s+){{1,3}}{street}\b(?:,?\s*(?:Apartment|Apt\.?|Suite|Unit)\s*\w+)?(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)?(?:,\s*[A-Z]{{2}}\s*\d{{5}})?", text):
        c = _ctx(text, m.start(), m.end(), 60)
        if "home" in c or "your home" in c:
            add(m, "HOME_ADDRESS", 0.95, "street-pattern+home-context")
        elif "inc." in c or "group, inc" in c:
            continue  # registered office address: corporate, not personal
        else:
            add(m, "HOME_ADDRESS", 0.6, "street-pattern (review)")

    # {0,3} (was {1,3}) so "+1 (555) 0139" - area code then a single group - still matches; gated by 'strong' below
    phone = r"(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)\s?)?\d{1,5}(?:[\s.-]\d{2,5}){0,3}"
    for m in re.finditer(phone, text):
        s = m.group().strip()
        d = re.sub(r"\D", "", s)
        if not (7 <= len(d) <= 15):
            continue
        if re.fullmatch(r"\d{3}-\d{2}-\d{4}", s) or re.fullmatch(DATE, s):
            continue
        if re.match(r"(?:19|20)\d\d-\d", s):      # year-prefixed reference id (ISS-2026-0112), not a phone
            continue
        c = _ctx(text, m.start(), m.end(), 25)
        # whole-segment numeric (e.g. an OCR-wrapped "20 7555 0129" cell) is phone-like even without +/keyword
        whole_number = s == text.strip()
        strong = s.startswith("+") or s.startswith("(") or whole_number or re.search(r"mobile|phone|tel|line|reach|call|contact", c)
        if strong:
            add(m, "PHONE", 0.9 if s.startswith("+") else 0.8, "phone-format+context")

    for m in re.finditer(r"\b[A-Z]{2,4}-\d{5}-\d{4}-\d{4}\b", text):
        add(m, "CREDENTIAL_ID", 0.85, "badge-credential-pattern")
    for m in re.finditer(r"PHOTOGRAPH ON FILE", text):
        add(m, "PHOTO", 0.8, "photo-label (image region)")
    for m in re.finditer(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text):
        if all(0 <= int(x) <= 255 for x in m.group().split(".")):
            add(m, "IP_ADDRESS", 0.85, "ipv4")
    return out


# Generic, domain-reusable stop-words only. Company names, vendor names, cities and countries are NOT
# hard-coded here (that overfits to one corpus); they are suppressed dynamically via spaCy ORG/GPE/LOC
# entities built per document (see person_and_org_spans + detect_all).
NAME_STOP = set("""Group Risk Committee Board Chief Officer Policy Management Financial Audit Asset Liability
Executive Director Committee Consumer Banking Investment Capital Markets Global Technology Services Operational Credit
Conduct Compliance Product Approval Divisional First Second Third Line Appendix Section Figure Table Version Internal
Head Privacy Data Protection Security Information Vice President Enterprise Framework Speak Up Remuneration Business
Regulation Authority Conduct Standards Staffing Analytics Screening Integrity Vendor Partners Partner Workflow Tier
Logistics Technologies Holdings Solutions Ventures Industries Consulting Enterprises Associates Advisory Corporation
Incorporated Ltd LLC LLP Inc GmbH Limited Company Companies Insurance Fintech Labs Studio Studios
Questionnaire Diligence Due Template Templates Attribute Settings User Groups Users Admin Live Launch Stage Rules Rule
Revenue Marketing International Service Providers Legal Finance Procurement Quality Contracting Systems Integration
New Third Party Default Local Prospective Employees Doing Platinum Lane Court Crescent
Effective Ineffective Elective Partially Moderate Elevated
Street Apartment Unauthorised Payment Processing Sanctions Records Customer Key Person Residual Rating Owner
Contact Status Target Signature Date Attested Challenger Received Scope Cycle Page Form Severity Issue Incident
Dir VP CRO CEO CFO CIO Chair Cnar Char Challenged Cloud General Counsel Reviewer Peer Client Confidential""".split())


from wordfreq import zipf_frequency as _zf

FIRST_NAMES = set("""james john robert michael william david richard joseph thomas charles christopher chris daniel matthew
anthony mark donald steven paul andrew joshua kenneth kevin brian george edward ronald timothy jason jeffrey ryan jacob
gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel frank gregory raymond alexander patrick
jack dennis jerry tyler aaron jose adam henry nathan douglas peter kyle walter ethan jeremy harold keith christian roger
noah gerald carl terry sean austin arthur lawrence jesse dylan bryan joe jordan billy bruce albert willie gabriel logan
alan juan wayne roy ralph randy eugene vincent russell elijah louis bobby philip johnny mary patricia jennifer linda
elizabeth barbara susan jessica sarah karen nancy lisa betty margaret sandra ashley kimberly emily donna michelle dorothy
carol amanda melissa deborah stephanie rebecca sharon laura cynthia kathleen amy shirley angela helen anna brenda pamela
nicole emma samantha katherine christine debra rachel catherine carolyn janet ruth maria heather diane virginia julie
joyce victoria olivia kelly christina lauren joan evelyn judith megan cheryl andrea hannah martha jacqueline frances
gloria ann teresa kathryn sara janice jean alice madison doris abigail julia judy grace denise amber marilyn beverly
danielle theresa sophia marie diana brittany natalie isabella charlotte rose alexis kayla rob dk tamika daniela
rahul priya amit sunil anil raj ravi vijay arjun rohan neha pooja anjali kavya divya siddharth madhav nikhil srinivas
jyoti sneha arvind ananya devansh priyanka elena emilio gregor marcus denis karsten""".split())


def _name_like(tok, strict=False):
    if re.fullmatch(r"[A-Z]\.?", tok):
        return True
    if tok.isupper() and len(tok) > 2:
        return False
    if re.search(r"[a-z][A-Z]", tok):       
        return False
    return bool(re.fullmatch(r"[A-Z][a-z'-]+(?:-[A-Z][a-z]+)?", tok))


def first_ok(tok):
    return tok.lower() in FIRST_NAMES or _zf(tok.lower(), "en") < 4.0


def plausible_person(toks, ocr=False):
    toks = [t for t in toks if t]
    if len(toks) < 2 or not all(_name_like(t) for t in toks):
        return False
    if any(t in NAME_STOP for t in toks):
        return False
    words = [t for t in toks if len(t.rstrip(".")) > 1]
    if words and words[0].lower() in FIRST_NAMES:
        return True
    if ocr:  
        return False
    return any(_zf(t.lower().replace("-", ""), "en") < 3.0 for t in words)


def _persons_from_ents(doc, ocr=False):
    out = []
    for e in doc.ents:
        if e.label_ != "PERSON":
            continue
        parts = [(m.start(), m.end(), m.group().strip(",;:()'\"")) for m in re.finditer(r"\S+", e.text)]
        while parts and not (_name_like(parts[0][2]) and parts[0][2] not in NAME_STOP and
                             (parts[0][2].lower() in FIRST_NAMES or _zf(parts[0][2].lower(), "en") < 4.5 or len(parts[0][2]) <= 2)):
            parts.pop(0)
        while parts and not (_name_like(parts[-1][2]) and parts[-1][2] not in NAME_STOP):
            parts.pop()
        if len(parts) < 2 or not plausible_person([p[2] for p in parts], ocr):
            continue
        out.append((e.start_char + parts[0][0], e.start_char + parts[-1][1], "PERSON", 0.7, "spacy-ner (filtered)"))
    return out


def person_spans_ner(nlp, text, ocr=False):
    return _persons_from_ents(nlp(text), ocr)


NAME_TOKEN = r"[A-Z][a-z]+(?:-[A-Z][a-z]+)?"
NAME_FULL = rf"(?<![A-Z]\.\s)(?<![A-Z]\.)(?<![-A-Za-z])(?:{NAME_TOKEN}\s+(?:[A-Z]\.\s+){{1,2}}{NAME_TOKEN}(?:-[A-Z][a-z]+)?)"   # Miriam T. Achebe
NAME_INIT = rf"(?:(?:[A-Z]\.\s?){{1,2}}\s?[A-Z][a-z]+(?:-[A-Z][a-z]+)?)"                # T. Lindqvist / N. K. Osadebe


def person_spans_pattern(text):
    out = []
    for m in re.finditer(NAME_FULL, text):
        toks = re.findall(r"[A-Za-z-]+", m.group())
        if not any(t in NAME_STOP for t in toks) and first_ok(toks[0]):
            out.append((m.start(), m.end(), "PERSON", 0.9, "first-initial-last pattern"))
    for m in re.finditer(rf"({NAME_TOKEN}(?:\s+[A-Z]\.)?(?:\s+{NAME_TOKEN}))\s*\((?:EMP|DIR|MER)-", text):
        toks = m.group(1).split()
        if not any(t in NAME_STOP for t in toks) and first_ok(toks[0]):
            out.append((m.start(1), m.end(1), "PERSON", 0.95, "name anchored by employee-id"))
    for m in re.finditer(NAME_INIT, text):
        sur = m.group().split()[-1].split(".")[-1]
        # the leading initial is itself a strong name signal, so accept even a common-word surname
        # (e.g. "H. Park") - only reject stop-words and 1-2 char fragments
        if sur in NAME_STOP or len(sur) < 3:
            continue
        out.append((m.start(), m.end(), "PERSON", 0.7, "initial+surname pattern"))
    # period-less initial cluster + surname (e.g. "KC Burney", "DK Koran"); surname must be rare to avoid "AI Adoption"
    for m in re.finditer(r"\b([A-Z]{2,3})\s+([A-Z][a-z]{2,}(?:-[A-Z][a-z]+)?)\b", text):
        sur = m.group(2)
        if sur not in NAME_STOP and _zf(sur.lower().replace("-", ""), "en") < 4.0:
            out.append((m.start(), m.end(), "PERSON", 0.7, "initials-cluster+surname"))
    # plain First Last (e.g. "Erik Hansen", "Mark Read", "Skylar Damiano")
    for m in re.finditer(rf"\b({NAME_TOKEN})\s+({NAME_TOKEN})\b", text):
        first, sur = m.group(1), m.group(2)
        if any(t in NAME_STOP for t in re.split(r"-", first) + re.split(r"-", sur)):
            continue  # reject if any hyphen part is a stop-word, e.g. "Third-Party" -> "Third"
        if first.lower() in FIRST_NAMES or (_zf(first.lower().replace("-", ""), "en") < 4.0
                                            and _zf(sur.lower().replace("-", ""), "en") < 4.0):
            out.append((m.start(1), m.end(2), "PERSON", 0.7, "first-last name"))
    return out


def norm_surname(s):
    return re.sub(r"[^a-z]", "", s.lower())


def person_key(name):
    toks = [t for t in re.findall(r"[A-Za-z][A-Za-z'-]*", name)]
    if not toks:
        return None
    sur = norm_surname(toks[-1])
    first = toks[0][0].lower()
    return (first, sur)


def email_key(email):
    local = email.split("@")[0].lower()
    if "." in local:
        a, b = local.split(".", 1)
        if a and b:
            return (a[0], re.sub(r"[^a-z]", "", b))
    return None


def gazetteer_spans(text, gaz):
    out = []
    for name in gaz:
        for m in re.finditer(r"\b" + re.escape(name) + r"(?:'s)?\b", text):
            out.append((m.start(), m.end(), "PERSON", 0.85, "seeded-gazetteer"))
    return out


def resolve_overlaps(spans):
    prio = {k: i for i, k in enumerate(["SSN", "PASSPORT", "PAN_IN", "PESEL", "AADHAAR", "NHS_NUMBER", "IBAN",
                                          "NINO", "TIN", "CARD_NUMBER", "DOB", "HOME_ADDRESS", "EMAIL",
                                          "EMPLOYEE_ID", "SSN_PARTIAL", "CARD_PARTIAL",
                                          "ACCOUNT_PARTIAL", "IP_ADDRESS", "PHONE", "PERSON"])}
    spans = sorted(spans, key=lambda s: (prio.get(s[2], 99), -s[3], -(s[1] - s[0])))
    taken, keep = [], []
    for s in spans:
        if any(not (s[1] <= a or s[0] >= b) for a, b in taken):
            continue
        taken.append((s[0], s[1]))
        keep.append(s)
    return sorted(keep)


TO_DIGIT = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "S": "5", "B": "8", "Z": "2", ".": "-", " ": "-"})
TO_ALPHA = str.maketrans({"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z"})


def _kw(text, words, maxd=1):
    from rapidfuzz.distance import Levenshtein
    for m in re.finditer(r"[A-Za-z]{3,}", text):
        for w in words:
            if Levenshtein.distance(m.group().lower(), w) <= (2 if len(w) >= 6 else maxd):
                yield m, w


def ocr_tolerant_spans(text):
    out = []
    for m, w in _kw(text, ["ssn", "pan", "passport", "mobile"]):
        nxt = re.match(r"[\s:]*([A-Za-z0-9./|-]{6,14})", text[m.end():])
        if not nxt:
            continue
        raw = nxt.group(1)
        a, b = m.end() + nxt.start(1), m.end() + nxt.end(1)
        if w == "ssn":
            v = raw.translate(TO_DIGIT)
            if re.fullmatch(r"\d{3}-\d{2}-\d{4}", v):
                out.append((a, b, "SSN", 0.75, "ocr-tolerant: fuzzy keyword + confusable repair"))
        elif w == "pan":
            v = re.sub(r"[^A-Za-z0-9]", "", raw)
            if len(v) == 10:
                v = v[:5].upper().translate(TO_ALPHA) + v[5:9].translate(TO_DIGIT) + v[9].upper().translate(TO_ALPHA)
                if re.fullmatch(r"[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]", v):
                    out.append((a, b, "PAN_IN", 0.75, "ocr-tolerant: fuzzy keyword + confusable repair"))
        elif w == "passport":
            if re.fullmatch(r"[A-Z0-9]{1,2}\d{6,8}", raw):
                out.append((a, b, "PASSPORT", 0.75, "ocr-tolerant: keyword + relaxed prefix"))
        elif w == "mobile":
            v = re.sub(r"\D", "", raw)
            if 7 <= len(v) <= 15:
                out.append((a, b, "PHONE", 0.75, "ocr-tolerant: fuzzy keyword"))
    return out
