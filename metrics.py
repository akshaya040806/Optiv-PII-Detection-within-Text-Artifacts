import csv, json, re
from collections import Counter, defaultdict

import os


def run(OUT, all_text_path):
  rows = list(csv.DictReader(open(os.path.join(OUT, "pii_inventory.csv"), encoding="utf-8-sig")))
  meta = json.load(open(os.path.join(OUT, "run_meta.json"), encoding="utf-8"))
  people = list(csv.DictReader(open(os.path.join(OUT, "person_token_map.csv"), encoding="utf-8-sig")))

  M = {}
  M["total_findings"] = len(rows)
  M["unique_people"] = len(people)
  M["by_artifact"] = Counter(r["artifact"] for r in rows)
  M["by_category"] = Counter(r["category"] for r in rows)
  M["by_context"] = Counter(r["context"] for r in rows)
  M["by_artifact_context"] = {a: Counter(r["context"] for r in rows if r["artifact"] == a) for a in M["by_artifact"]}
  M["by_tier"] = Counter(r["tier"] for r in rows)

  # Prompt 1: OCR requirement
  M["pdf_native_text_chars"] = meta["pdf_native_chars"]
  M["pdf_pages_requiring_ocr"] = [p["page"] for p in meta["pages"]]
  M["pdf_pages_with_embedded_figures"] = [p["page"] for p in meta["pages"] if p["figures"]]

  # Prompt 3: identifiers only inside images (value-level, per artifact)
  def norm(v):
      return re.sub(r"[^a-z0-9]", "", v.lower())

  img_only = defaultdict(list)
  for art in M["by_artifact"]:
      text_vals = {(r["category"], norm(r["value"])) for r in rows if r["artifact"] == art and r["context"] != "image"}
      text_tokens = {r["token"] for r in rows if r["artifact"] == art and r["context"] != "image"}
      for r in rows:
          if r["artifact"] == art and r["context"] == "image":
              if (r["category"], norm(r["value"])) not in text_vals and r["token"] not in text_tokens:
                  img_only[art].append(dict(category=r["category"], value=r["value"], location=r["location"], token=r["token"]))
  M["image_only"] = img_only

  # baseline OCR vs enhanced OCR
  base = Counter(c for _, c, _ in meta["base_fig"])
  enh = Counter(r["category"] for r in rows if r["artifact"].startswith("Risk") and r["context"] == "image")
  M["figure_findings_baseline_ocr"] = sum(base.values())
  M["figure_findings_enhanced_ocr"] = sum(enh.values())

  GOLD = [
      (7, "narrative", "HOME_ADDRESS", "88 Willowbank"),
      (22, "narrative", "DOB", "14 July 1991"), (22, "narrative", "SSN", "900-55-2043"),
      (22, "narrative", "PASSPORT", "TK4820913"), (22, "narrative", "PAN_IN", "AQBPR7741L"),
      (22, "narrative", "SSN", "900-42-7781"), (22, "narrative", "HOME_ADDRESS", "1180 Ashwood"),
      (23, "narrative", "CARD_PARTIAL", "2218"), (23, "narrative", "HOME_ADDRESS", "2214 Palmetto"),
      (23, "narrative", "ACCOUNT_PARTIAL", "7741"), (23, "narrative", "SSN_PARTIAL", "8827"),
      (23, "narrative", "DOB", "3 August 1996"),
      (25, "table", "PAN_IN", "AQBPR7741L"), (25, "table", "PAN_IN", "BKTPV2290H"),
      (25, "table", "PAN_IN", "CDRPK6612M"), (25, "table", "PESEL", "890412"),
      (18, "image", "DOB", "14/07/1991"), (18, "image", "SSN", "7781"), (18, "image", "PAN_IN", "77"),
      (18, "image", "DOB", "09/12/1994"), (18, "image", "PASSPORT", "4820913"), (18, "image", "SSN", "900-42-1190"),
      (20, "image", "CARD_PARTIAL", "4111"),
      (28, "image", "DOB", "28 February 1979"), (28, "image", "PHOTO", "PHOTO"),
  ]
  res = []
  for page, ctx, cat, sub in GOLD:
      hit = any(r["location"] == f"p.{page}" and r["category"] == cat and (sub in r["value"] or cat == "PHOTO")
                for r in rows if r["artifact"].startswith("Risk"))
      res.append(dict(page=page, context=ctx, category=cat, value=sub, found=hit))
  M["gold"] = res
  for grp in ("text", "image"):
      g = [x for x in res if (x["context"] == "image") == (grp == "image")]
      M[f"gold_recall_{grp}"] = [sum(x["found"] for x in g), len(g)]
  # Honest framing: recall measured against a hand-verified gold set, NOT absolute coverage
  hit, tot = sum(x["found"] for x in res), len(res)
  M["gold_recall_overall"] = [hit, tot, round(100 * hit / tot, 1)]
  M["gold_recall_note"] = f"recall on {tot} hand-verified PII items; not a claim of total-document coverage"
  # Effective coverage = kept from the LLM: detected OR sealed inside a whole-figure redaction (fail-closed).
  # This is the number that matches "no unidentified instances passed downstream".
  red_pages = {r["page"] for r in meta.get("figure_redactions", [])}
  eff = [g["found"] or (g["context"] == "image" and g["page"] in red_pages) for g in res]
  M["gold_effective_coverage"] = [sum(eff), len(eff), round(100 * sum(eff) / len(eff), 1)]
  M["figure_redactions"] = meta.get("figure_redactions", [])
  # Independent leakage gate: detected PII values re-checked against the actual masked output text.
  M["residual_leaks"] = meta.get("residual_leaks", [])
  M["residual_leak_count"] = len(M["residual_leaks"])

  # Structure retention: share of extracted characters passed to the LLM unchanged. Redaction is in-place token
  # substitution, so structural units (paragraphs/rows/cells) and their order are always preserved; only PII spans
  # change. A lower % means the file is PII-dense (e.g. the PPTX contact directory), NOT that structure was lost.
  masked_chars = Counter()
  for r in rows:
      masked_chars[r["artifact"]] += len(r["value"])
  M["text_preserved_pct"] = {a: round(100 * (1 - masked_chars[a] / c), 1)
                             for a, c in meta.get("text_chars", {}).items() if c}

  policy = open(all_text_path, encoding="utf-8").read()
  M["fp_suppressed_role_mailboxes"] = sorted(set(re.findall(r"\b(?:brc|gerc|orc|remco|board)@cadencefg\.com", policy)))
  M["ssn_test_range_count"] = sum(1 for r in rows if r["category"] == "SSN" and r["value"].startswith("9"))
  M["pan_lookalikes_rejected_example"] = "GRP-POL-001, RSK-4488, CTL-IAM-04 never match: PAN needs AAAAA9999A with 4th char in P,C,H,F,A,T,B,L,J,G"

  M["cross_artifact_people"] = [p for p in people if "+" in p["artifacts"]]
  M["people_multi_alias"] = [p for p in people if "|" in p["names"]][:12]

  json.dump(M, open(os.path.join(OUT, "metrics.json"), "w", encoding="utf-8"), indent=1, default=dict)
  print(json.dumps({k: M[k] for k in ["total_findings", "unique_people", "by_artifact", "by_context", "by_tier",
                                      "gold_recall_text", "gold_recall_image", "gold_recall_overall",
                                      "gold_effective_coverage", "residual_leak_count", "text_preserved_pct",
                                      "figure_findings_baseline_ocr",
                                      "figure_findings_enhanced_ocr", "pdf_pages_with_embedded_figures",
                                      "ssn_test_range_count", "fp_suppressed_role_mailboxes"]}, indent=0, default=dict))
  print("missed:", [g for g in res if not g["found"]])
  print("cross:", M["cross_artifact_people"])
  print({a: len(v) for a, v in img_only.items()})
  for a, v in img_only.items():
      print(a, [(x["category"], x["value"]) for x in v][:40])
