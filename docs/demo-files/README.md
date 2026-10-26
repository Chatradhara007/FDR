# Demo files

`npm run seed` writes the sample PDFs for demo step 1 here: `A1-fdr-copy.pdf` and `A1-bank-letter.pdf`
(anchor A1, `SBIN/FDR/2026/00731`, State Bank of India, ₹20,00,000). They carry dates relative to the day of
the seed (issued D0−10, matures D0+355), so they are regenerated on every seed and not committed.

The same files can be downloaded at any time from **Admin → Demo tools → Demo anchors** ("A1 FDR copy",
"A1 bank letter"); those are printed from the mock bank's current A1 record, so they also work under Docker.
All content is synthetic ("Demo Bank Letter — synthetic data").
