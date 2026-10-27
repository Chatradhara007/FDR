# Demo files

`npm run seed` writes the sample PDFs for demo step 1 here: `A1-fdr-copy.pdf`, `A1-fdr-copy-different-amount.pdf` and
`A1-bank-letter.pdf` (anchor A1, `SBIN/FDR/2026/00731`, State Bank of India; the bank holds ₹20,00,000). The FDR copy
prints the amount the presenter claims (₹25,00,000), so the officer's text cross-check matches and only the bank reveals the
mismatch; "FDR copy with a different amount" prints the bank's ₹20,00,000, so the cross-check disagrees; the bank letter
always shows the bank's values. They carry dates relative to the day of
the seed (issued D0−10, matures D0+355), so they are regenerated on every seed and not committed.

The same files can be downloaded at any time from **Admin → Demo tools → Demo anchors** ("A1 FDR copy",
"A1 FDR copy with a different amount", "A1 bank letter"); those are printed from the mock bank's current A1 record, so they also work under Docker.
All content is synthetic ("Demo Bank Letter — synthetic data").
