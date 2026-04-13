# Google Sheets Schema: Mastodon LinkedIn Content Queue

Create a Google Sheet named **"Mastodon LinkedIn Content Queue"** with these exact columns in Row 1:

| Column | Header | Format | Notes |
|--------|--------|--------|-------|
| A | Date Created | Date | Auto-filled by Make.com |
| B | Topic | Text | From intelligence scan |
| C | Source URL | URL | RSS/news source |
| D | Bucket | Dropdown: GROWTH/AUTHORITY/CONVERSION/PERSONAL | |
| E | Urgency Score | Number 1-10 | From intelligence prompt |
| F | Draft | Long text | Full LinkedIn post text |
| G | QC Score | Number | Weighted average from QC rubric |
| H | QC Verdict | Text | PASS / REGENERATE / MANUAL_REWRITE |
| I | QC Feedback | Long text | Improvement notes |
| J | Status | Dropdown: Pending Review/Approved/Rejected/Scheduled/Published | |
| K | GHL Post ID | Text | Returned by GHL API after scheduling |
| L | Scheduled Date | DateTime | When post is scheduled for |
| M | Impressions | Number | Pulled 48h after posting |
| N | Reactions | Number | Pulled 48h after posting |
| O | Comments | Number | Pulled 48h after posting |
| P | Reposts | Number | Pulled 48h after posting |
| Q | Notes | Long text | Manual notes from Alex |

## Setup Notes

1. Add dropdown data validation on column D: `GROWTH, AUTHORITY, CONVERSION, PERSONAL`
2. Add dropdown data validation on column J: `Pending Review, Approved, Rejected, Scheduled, Published`
3. The Sheet ID is the long string in the URL between `/d/` and `/edit`
4. Share the sheet with your Google service account email if using service account auth
