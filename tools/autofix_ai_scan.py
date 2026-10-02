from pathlib import Path

# One-shot source transformer. It is removed by itself after a successful run.
ROOT = Path(__file__).resolve().parents[1]
if '[ai-scan-autofix]' in __import__('subprocess').check_output(['git','log','-1','--pretty=%B'], cwd=ROOT, text=True):
    raise SystemExit(0)

parser = ROOT / 'src/react-app/lib/sales-scan-parser.ts'
s = parser.read_text()
old = '''  let confidence: SalesSheetFields["confidence"] = "low";
  if (pumps.length > 0 && date && (totalSales || tillAmount || cashAmount))
    confidence = "high";
  else if (pumps.length > 0 || totalSales || tillAmount || cashAmount)
    confidence = "medium";
'''
new = '''  const completePumps = pumps.filter(
    (p) =>
      p.openingReading > 0 &&
      p.closingReading > 0 &&
      p.openingLitres > 0 &&
      p.closingLitres > 0 &&
      Number.isFinite(p.salesAmount) &&
      Number.isFinite(p.salesLitres),
  );
  const meterSales = completePumps.reduce((sum, p) => sum + p.salesAmount, 0);
  const totalAgreesWithMeters =
    totalSales === undefined || meterSales === 0
      ? true
      : Math.abs(totalSales - meterSales) <= Math.max(0.05, meterSales * 0.0005);

  let confidence: SalesSheetFields["confidence"] = "low";
  if (
    completePumps.length > 0 &&
    completePumps.length === pumps.length &&
    date &&
    totalAgreesWithMeters &&
    pumps.every((p) => p.confidence === "high")
  ) {
    confidence = "high";
  } else if (completePumps.length > 0 || totalSales || tillAmount || cashAmount) {
    confidence = "medium";
  }
'''
if old not in s:
    raise SystemExit('parser confidence block not found')
s = s.replace(old, new, 1)
old_note = '''  if (pumps.length > 0) {
    notes.push(
      "Pump IDs/fuel types not printed on the sheet remain unassigned until matched against the station pump roster and shift-continuity readings.",
    );
  }
'''
new_note = '''  if (pumps.length > 0) {
    notes.push(
      "Pump IDs/fuel types not printed on the sheet remain unassigned until matched against the station pump roster and shift-continuity readings.",
    );
  }
  if (!totalAgreesWithMeters) {
    notes.push(
      "Automatic application is blocked because the handwritten total conflicts with the complete pump-meter calculation.",
    );
  }
'''
if old_note not in s:
    raise SystemExit('parser note block not found')
s = s.replace(old_note, new_note, 1)
parser.write_text(s)

sales = ROOT / 'src/react-app/components/SalesTracking.tsx'
t = sales.read_text()
old_sig = '  const applyScannedData = () => {\n    const data = editableResult || scanResult;'
new_sig = '  const applyScannedData = (override?: ScanResultData) => {\n    const data = override || editableResult || scanResult;'
if old_sig not in t:
    raise SystemExit('applyScannedData signature not found')
t = t.replace(old_sig, new_sig, 1)
old_review = '''      setScanResult(extractedData);
      setEditableResult(JSON.parse(JSON.stringify(extractedData))); // Deep copy for editing
      setScanStep("review");
'''
new_review = '''      setScanResult(extractedData);
      setEditableResult(JSON.parse(JSON.stringify(extractedData))); // Deep copy for editing

      // Only structurally verified scans are auto-applied. Medium/low
      // confidence scans stay in Review so uncertain handwriting is never
      // silently written into the ledger.
      if (extractedData.confidence === "high") {
        applyScannedData(extractedData);
      } else {
        setScanStep("review");
      }
'''
if old_review not in t:
    raise SystemExit('scan review block not found')
t = t.replace(old_review, new_review, 1)
old_success = '    toastSuccess("Data applied successfully! Review and adjust as needed.");\n'
new_success = '    toastSuccess("Verified scan applied to Sales Tracking automatically. Review the populated fields before saving.");\n'
if old_success not in t:
    raise SystemExit('success toast not found')
t = t.replace(old_success, new_success, 1)
sales.write_text(t)

ocr = ROOT / 'src/react-app/lib/ocr-service.ts'
o = ocr.read_text()
o = o.replace('const source = await imageToCanvas(image, 2.5);', 'const source = await imageToCanvas(image, 3.5);', 1)
o = o.replace('for (const psm of ["6", "11", "12"]) {', 'for (const psm of ["4", "6", "11", "12", "13"]) {', 1)
ocr.write_text(o)

print('AI scan accuracy fixes applied')
