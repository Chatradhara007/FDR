# Demo-video sample deposits

Two sets of four FDRs (09001–09004 and 09005–09008, the same four cases) for Institution 1 (Vasavi Institute of Engineering & Technology, Hyderabad). They are **not** seeded as
portal instruments: the institution lodges them live in the video. The mock bank always knows them
(`mock-bank/mock_bank/video_records.py`), in demo mode, showcase mode and the production image.
Regenerate the PDFs with `node scripts/py.mjs --cwd backend ../scripts/gen_video_samples.py`.

Form values for all four: type FDR, branch Begumpet (09004 and 09008: Anna Salai), amount 25,00,000, issue date 2026-09-15,
maturity date 2029-09-15, in favour of MEMBER SECRETARY AICTE, lien marked: yes.

| Reference | Issuing bank | Bank holds | Officer's bank check |
|---|---|---|---|
| SBIN/FDR/2026/09001 | State Bank of India | same as the form | All seven fields confirmed |
| SBIN/FDR/2026/09002 | State Bank of India | amount 24,00,000 | Mismatch: amount |
| SBIN/FDR/2026/09003 | State Bank of India | maturity 2029-03-15 | Mismatch: maturity date |
| SBIN/FDR/2026/09004 | Indian Overseas Bank | same as the form | Bank unavailable (offline-test bank) |
| SBIN/FDR/2026/09005 | State Bank of India | same as the form | All seven fields confirmed |
| SBIN/FDR/2026/09006 | State Bank of India | amount 24,00,000 | Mismatch: amount |
| SBIN/FDR/2026/09007 | State Bank of India | maturity 2029-03-15 | Mismatch: maturity date |
| SBIN/FDR/2026/09008 | Indian Overseas Bank | same as the form | Bank unavailable (offline-test bank) |

09002 (or 09006) after the officer returns it: change the amount to 24,00,000, replace both documents with
`…-corrected-fdr-copy.pdf` and `…-corrected-bank-letter.pdf` from its folder, and submit again; the bank check then confirms.
