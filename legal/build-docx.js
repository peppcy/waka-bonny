// Turns legal/content.js into one Word file per document.
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
const L = require('./content.js');

const INK = '12262B', TEAL = '0E4D5C', GREY = '5B6F73';
const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

function build(doc) {
  const kids = [
    new Paragraph({ children: [new TextRun({ text: L.APP, bold: true, size: 26, color: TEAL })], spacing: { after: 60 } }),
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE, spacing: { after: 60 } }),
    new Paragraph({
      children: [new TextRun({ text: `${L.COMPANY} (${L.RC}) · Last updated ${L.UPDATED}`, size: 19, color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D5DFDD', space: 10 } }, spacing: { after: 260 }
    }),
    new Paragraph({ children: [new TextRun({ text: doc.intro, size: 22 })], spacing: { after: 240 }, alignment: AlignmentType.JUSTIFIED })
  ];
  doc.sections.forEach(([heading, paras], i) => {
    kids.push(new Paragraph({
      children: [new TextRun({ text: `${i + 1}. ${heading}`, bold: true, size: 24, color: TEAL })],
      spacing: { before: 260, after: 100 }, keepNext: true
    }));
    paras.forEach(p => kids.push(new Paragraph({
      children: [new TextRun({ text: p, size: 22, color: INK })],
      spacing: { after: 140, line: 300 }, alignment: AlignmentType.JUSTIFIED
    })));
  });
  kids.push(new Paragraph({
    children: [new TextRun({ text: `${L.COMPANY} · ${L.ADDRESS} · ${L.EMAIL}`, size: 18, color: GREY })],
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'D5DFDD', space: 10 } },
    spacing: { before: 320 }, alignment: AlignmentType.CENTER
  }));
  return new Document({
    creator: L.COMPANY, title: `${L.APP} ${doc.title}`, description: `${L.APP} ${doc.title}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: INK } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: kids }]
  });
}

(async () => {
  for (const doc of L.docs) {
    const file = path.join(out, `Waka Bonny ${doc.title}.docx`);
    fs.writeFileSync(file, await Packer.toBuffer(build(doc)));
    console.log('wrote', path.basename(file));
  }
  // the same text as JSON, for the pages inside the app
  fs.writeFileSync(path.join(__dirname, 'legal.json'), JSON.stringify({
    updated: L.UPDATED, company: L.COMPANY, rc: L.RC, address: L.ADDRESS, email: L.EMAIL,
    docs: L.docs.map(d => ({ id: d.id, title: d.title, intro: d.intro, sections: d.sections }))
  }, null, 1));
  console.log('wrote legal.json');
})();
