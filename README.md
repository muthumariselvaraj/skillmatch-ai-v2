# SkillMatch AI

Full-stack recruitment platform: workers upload a resume and apply, managers see skill-match scores, read resumes in a protected viewer, select or reject, and send professional offer letters (PDF).

## Run it (Node.js 18 or newer, no `npm install` needed)

    copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
    npm run seed                (optional, local demo accounts)
    npm start                   (then open http://localhost:3000)
    npm test                    (end-to-end test of the whole hiring flow, 40 checks)

Demo accounts after `npm run seed` (local development only): `asha@demo.test` (manager) and `arun@demo.test` (worker), password `Demo@1234`.

## Folder structure

    server.js          API routes, auth, access control, file serving
    lib/match.js       skill matching and scoring
    lib/resume.js      text extraction from PDF and DOCX
    lib/pdf.js         offer letter PDF generator
    seed.js            demo data (local only)
    test/e2e.js        automated end-to-end test
    public/            website: index, worker/manager login + dashboards
      css/style.css  js/app.js (shared)  js/worker.js  js/manager.js  img/ (your 3 backgrounds)
    db.json, uploads/  created at runtime (data and resumes). Do not commit.

## Authentication and storage (what is used instead of Firebase)

This build runs without any packages or cloud accounts, so it uses its own secure backend:
passwords hashed with scrypt and a random salt (never stored in plain text), signed 8-hour login tokens, role checked on the server for every request, login rate limiting, password reset tokens that expire in 30 minutes.
Data lives in `db.json` and resumes in `uploads/` on the server (never in `public/`, never at a public URL).
To move to Firebase or PostgreSQL later, replace the `db` object and the `uploads` folder usage in `server.js`.

## Access control (enforced in server.js)

| Who | Allowed |
|---|---|
| Worker | Own profile, resume, applications, offers, messages. Accept or decline own offers. Download own offer PDF. |
| Manager | Own company and vacancies. Applicants, resumes and threads only for vacancies they own. Select/reject, create and revise offers. |
| Never allowed | Workers changing statuses or creating offers. Managers downloading resumes or offer PDFs. Anyone reading another company's data. |

Resume viewing: the manager asks for a link that works for 5 minutes, is tied to that manager and application, and is served inline with `no-store`. There is no download button and the PDF toolbar is hidden.
Offer letters are never edited after sending. A revision creates a new version and the old one is kept as "superseded".

## Matching method (documented, not a language model)

Score out of 100: required skills 70 (80 when the job has no preferred skills), preferred skills 10, experience 15 (meets requirement = full, one level below = half), qualification 5 (a word of the job's minimum qualification appears in the worker's education).
A skill counts when it is in the worker's profile skills or found in the resume text (PDF/DOCX text extraction, with variants such as React.js / ReactJS). Without a resume or any skills the app shows "incomplete profile" instead of a score. The score supports the manager's decision; it never decides alone.

## How to test the full flow by hand

1. Worker: register, My Profile (fill required fields, upload a PDF or DOCX resume), Find Jobs, Apply Now.
2. Manager (another browser or private window): log in, Applicants, check the match, VIEW RESUME, SELECT.
3. Manager: GENERATE OFFER LETTER, fill compensation, start date and signatory, Preview, Send Offer.
4. Worker: Offer Letters, read, Download PDF, Accept or Decline with a message. Manager sees the reply in Messages and notifications.

## Not included (be aware before production)

Email sending (verification and reset emails; in dev the reset link is returned on screen when `DEV_SHOW_RESET_LINK=1`), email verification, company verification/approval of managers, company logo upload, OCR for scanned PDFs. `db.json` is fine for one server and light use; use a real database for production, set a long `SECRET`, and serve over HTTPS.
