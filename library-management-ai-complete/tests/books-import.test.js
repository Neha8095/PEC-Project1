const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const {
  classifyRows,
  isValidIsbn,
  normalizeIsbn,
  normalizeText,
  readFileRows,
} = require('../server/books-import')._test;

test('normalizes book fields and validates ISBN-10 and ISBN-13 check digits', () => {
  assert.equal(normalizeText('  Clean   Code\t'), 'Clean Code');
  assert.equal(normalizeIsbn('978-0-306-40615-7'), '9780306406157');
  assert.equal(isValidIsbn('0306406152'), true);
  assert.equal(isValidIsbn('9780306406157'), true);
  assert.equal(isValidIsbn('9780306406158'), false);
});

test('classifies invalid rows and duplicate ISBN or catalogue identifiers', () => {
  const classified = classifyRows([
    {
      row_number: 2,
      values: {
        isbn: '9780306406157',
        title: '  Example   Title ',
        author: 'Example Author',
        total_quantity: '4',
      },
    },
    {
      row_number: 3,
      values: {
        isbn: '9780306406157',
        title: 'Duplicate ISBN',
        author: 'Example Author',
        total_quantity: '2',
      },
    },
    {
      row_number: 4,
      values: {
        catalogue_id: 'LIB-LOCAL-1',
        title: 'No ISBN',
        author: 'Example Author',
        total_quantity: '0',
      },
    },
  ]);

  assert.equal(classified.validRows.length, 1);
  assert.equal(classified.validRows[0].book.title, 'Example Title');
  assert.equal(classified.duplicates.length, 1);
  assert.equal(classified.errors.length, 1);
  assert.equal(classified.errors[0].row_number, 4);
});

test('parses quoted CSV fields and rejects invalid required headers', async () => {
  const file = {
    originalname: 'books.csv',
    buffer: Buffer.from(
      'catalogue_id,isbn,title,author,category,publisher,publication_year,total_quantity,shelf_location\n' +
      ',9780132350884,"Clean Code, Revised","Robert C. Martin",Programming,,2008,5,P-03\n',
    ),
  };
  const rows = await readFileRows(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.title, 'Clean Code, Revised');
  assert.equal(rows[0].values.total_quantity, '5');

  await assert.rejects(
    readFileRows({ originalname: 'wrong.csv', buffer: Buffer.from('title,author\nBook,Author') }),
    /Missing required columns: total_quantity/,
  );
});

test('reads Excel workbooks using their first worksheet', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Books');
  sheet.addRow(['catalogue_id', 'isbn', 'title', 'author', 'total_quantity']);
  sheet.addRow(['LIB-LOCAL-2', '', 'A Workbook Title', 'An Author', 3]);
  const file = {
    originalname: 'books.xlsx',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };

  const rows = await readFileRows(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.catalogue_id, 'LIB-LOCAL-2');
  assert.equal(rows[0].values.total_quantity, '3');
});
