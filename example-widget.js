// Variables used by Scriptable.
// icon-color: blue; icon-glyph: check;

const widget = new ListWidget();
widget.backgroundColor = new Color("#1c1c1e");
widget.setPadding(16, 16, 16, 16);
const title = widget.addText("Loader is working");
title.font = Font.boldSystemFont(16);
title.textColor = Color.white();
widget.addSpacer(8);
const detail = widget.addText("This widget was loaded from your GitHub repository.");
detail.font = Font.systemFont(12);
detail.textColor = new Color("#a1a1aa");
widget.addSpacer(8);
const timestamp = widget.addDate(new Date());
timestamp.font = Font.systemFont(11);
timestamp.textColor = new Color("#a1a1aa");
timestamp.applyTimeStyle();
widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();

