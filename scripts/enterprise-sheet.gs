// ==========================================
// TEAMSKI ENTERPRISE LEADS + CONTACT -> GOOGLE SHEET
// ==========================================
//
// Contact sales enquiries go to the "Leads" tab and
// the front page's Contact us messages to "Contact".
// Both tabs are created on the first message.
//
// After changing this script, publish it again:
// Deploy -> Manage deployments -> edit (pencil) ->
// Version: New version -> Deploy. The URL stays the
// same, so nothing changes in .env.local.
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

    // The front page's Contact us form uses the same
    // web app, on its own tab.
    if (data.kind === "contact") {
      appendTo("Contact", CONTACT_HEADERS, [
        data.submittedAt ? new Date(data.submittedAt) : new Date(),
        data.name || "",
        data.email || "",
        data.topic || "",
        data.message || "",
      ]);

      return reply({ ok: true });
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

var CONTACT_HEADERS = ["Submitted at", "Name", "Email", "About", "Message"];

function appendTo(name, headers, row) {
  var sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name) ||
    SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  sheet.appendRow(row);
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  );
}
