// ==========================================
// TEAMSKI ENTERPRISE LEADS -> GOOGLE SHEET
// ==========================================
//
// Paste this into the sheet's Apps Script editor
// (Extensions -> Apps Script), then:
//
//   1. Project Settings -> Script Properties -> add
//      SECRET = the same value as ENTERPRISE_SHEET_SECRET
//      in the server's .env.local.
//   2. Deploy -> New deployment -> type "Web app"
//        Execute as: Me
//        Who has access: Anyone
//   3. Copy the web app URL (ends in /exec) into
//      ENTERPRISE_SHEET_URL in .env.local.
//
// "Anyone" can reach the URL, so the secret is what
// keeps strangers from writing rows. The server also
// neutralises formulas before sending.
//

var HEADERS = [
  "Submitted at",
  "Name",
  "Email",
  "Company",
  "Role",
  "Team size",
  "Phone",
  "Country",
  "What they need",
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var data = JSON.parse(e.postData.contents);

    var secret = PropertiesService.getScriptProperties().getProperty("SECRET");

    if (!secret || data.secret !== secret) {
      return reply({ ok: false, error: "unauthorised" });
    }

    var sheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Leads") ||
      SpreadsheetApp.getActiveSpreadsheet().insertSheet("Leads");

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      data.submittedAt ? new Date(data.submittedAt) : new Date(),
      data.name || "",
      data.email || "",
      data.company || "",
      data.role || "",
      data.teamSize || "",
      data.phone || "",
      data.country || "",
      data.needs || "",
    ]);

    return reply({ ok: true });
  } catch (error) {
    return reply({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  );
}
