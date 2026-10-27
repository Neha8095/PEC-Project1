const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');

const MAX_UPLOAD_MB = readPositiveInteger(process.env.MAX_UPLOAD_MB, 10);
const MAX_IMPORT_ROWS = readPositiveInteger(process.env.MAX_IMPORT_ROWS, 10000);
const BATCH_SIZE = 200;
const HEADER_ALIASES = new Map([
  ['catalogueid', 'catalogue_id'],
  ['catalogid', 'catalogue_id'],
  ['cataloguecode', 'catalogue_id'],
  ['internalid', 'catalogue_id'],
  ['isbn', 'isbn'],
  ['title', 'title'],
  ['author', 'author'],
  ['category', 'category'],
  ['publisher', 'publisher'],
  ['publicationyear', 'publication_year'],
  ['pubyear', 'publication_year'],
  ['year', 'publication_year'],
  ['totalquantity', 'total_quantity'],
  ['totalcopies', 'total_quantity'],
  ['quantity', 'total_quantity'],
  ['copies', 'total_quantity'],
  ['shelflocation', 'shelf_location'],
  ['shelf', 'shelf_location'],
]);
const REQUIRED_HEADERS = ['title', 'author', 'total_quantity'];

class ImportInputError extends Error {}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Object.hasOwn(value, 'result')) return normalizeText(value.result);
    if (typeof value.text === 'string') return normalizeText(value.text);
    return '';
  }
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeIsbn(value) {
  const text = normalizeText(value);
  return text ? text.replace(/[\s-]/g, '').toUpperCase() : null;
}

function isValidIsbn(value) {
  if (/^\d{9}[\dX]$/.test(value)) {
    const sum = [...value].reduce((total, char, index) => (
      total + (char === 'X' ? 10 : Number(char)) * (10 - index)
    ), 0);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(value)) {
    const sum = [...value].reduce((total, char, index) => (
      total + Number(char) * (index % 2 === 0 ? 1 : 3)
    ), 0);
    return sum % 10 === 0;
  }
  return false;
}

function normalizeHeader(value) {
  const key = normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES.get(key) || null;
}

function normalizeHeaders(headerValues) {
  const headers = headerValues.map(normalizeHeader);
  const knownHeaders = headers.filter(Boolean);
  if (new Set(knownHeaders).size !== knownHeaders.length) {
    throw new ImportInputError('The file contains duplicate column headers.');
  }
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new ImportInputError(`Missing required columns: ${missing.join(', ')}.`);
  }
  return headers;
}

function cellValue(value) {
  if (value instanceof Date) return value.getFullYear();
  return normalizeText(value);
}

async function readFileRows(file) {
  const extension = file.originalname.toLowerCase().split('.').pop();
  let headerValues;
  let rawRows;

  if (extension === 'csv') {
    let records;
    try {
      records = parse(file.buffer, {
        bom: true,
        columns: false,
        info: true,
        skip_empty_lines: true,
        to: MAX_IMPORT_ROWS + 2,
      });
    } catch (error) {
      throw new ImportInputError(`Unable to parse CSV: ${error.message}`);
    }
    if (!records.length) throw new ImportInputError('The CSV file is empty.');
    if (records.length > MAX_IMPORT_ROWS + 1) {
      throw new ImportInputError(`The file exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row limit.`);
    }
    headerValues = records[0].record;
    const headers = normalizeHeaders(headerValues);
    rawRows = records.slice(1).map(({ record, info }) => ({
      row_number: info.lines,
      values: Object.fromEntries(headers.map((header, index) => (
        header ? [header, record[index] ?? ''] : null
      )).filter(Boolean)),
    }));
  } else if (extension === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer);
    } catch {
      throw new ImportInputError('Unable to read the Excel file. Use a valid .xlsx workbook.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ImportInputError('The Excel workbook has no worksheet.');
    headerValues = sheet.getRow(1).values.slice(1).map(cellValue);
    const headers = normalizeHeaders(headerValues);
    rawRows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values.slice(1);
      if (!values.some((value) => normalizeText(value))) return;
      rawRows.push({
        row_number: rowNumber,
        values: Object.fromEntries(headers.map((header, index) => (
          header ? [header, cellValue(values[index])] : null
        )).filter(Boolean)),
      });
    });
    if (rawRows.length > MAX_IMPORT_ROWS) {
      throw new ImportInputError(`The file exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row limit.`);
    }
  } else {
    throw new ImportInputError('Only .csv and .xlsx files are supported.');
  }

  return rawRows.filter((row) => Object.values(row.values).some((value) => normalizeText(value)));
}

function validateRow(row) {
  const input = row.values;
  const errors = [];
  const text = (field) => normalizeText(input[field]);
  const title = text('title');
  const author = text('author');
  const isbn = normalizeIsbn(input.isbn);
  const catalogueId = text('catalogue_id').toUpperCase() || null;
  const publisher = text('publisher') || null;
  const category = text('category') || null;
  const shelfLocation = text('shelf_location') || null;
  const quantityText = text('total_quantity');
  const yearText = text('publication_year');
  const totalQuantity = /^\d+$/.test(quantityText) ? Number(quantityText) : NaN;
  const publicationYear = yearText ? Number(yearText) : null;

  if (!title) errors.push('Title is required.');
  else if (title.length > 255) errors.push('Title must be 255 characters or fewer.');
  if (!author) errors.push('Author is required.');
  else if (author.length > 180) errors.push('Author must be 180 characters or fewer.');
  if (isbn && !isValidIsbn(isbn)) errors.push('ISBN must be a valid ISBN-10 or ISBN-13, including its check digit.');
  if (!isbn && !catalogueId) errors.push('Catalogue ID is required when ISBN is blank.');
  if (catalogueId && (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(catalogueId))) {
    errors.push('Catalogue ID must be 1-40 letters, numbers, dots, underscores, or hyphens.');
  }
  if (!Number.isSafeInteger(totalQuantity) || totalQuantity < 1 || totalQuantity > 100000) {
    errors.push('Total quantity must be a whole number between 1 and 100000.');
  }
  if (yearText && (!Number.isInteger(publicationYear) || publicationYear < 1000 || publicationYear > new Date().getFullYear() + 1)) {
    errors.push('Publication year must be a four-digit year no later than next year.');
  }
  if (publisher && publisher.length > 180) errors.push('Publisher must be 180 characters or fewer.');
  if (category && category.length > 100) errors.push('Category must be 100 characters or fewer.');
  if (shelfLocation && shelfLocation.length > 80) errors.push('Shelf location must be 80 characters or fewer.');

  return {
    ...row,
    book: {
      catalogue_id: catalogueId,
      isbn,
      title,
      author,
      category,
      publisher,
      publication_year: publicationYear,
      total_quantity: totalQuantity,
      shelf_location: shelfLocation,
    },
    errors,
  };
}

function classifyRows(rawRows) {
  const seen = new Set();
  const validRows = [];
  const errors = [];
  const duplicates = [];
  const displayRows = [];

  for (const rawRow of rawRows) {
    const row = validateRow(rawRow);
    if (row.errors.length) {
      errors.push({ row_number: row.row_number, reasons: row.errors });
      displayRows.push({ ...row.book, row_number: row.row_number, status: 'ERROR', reasons: row.errors });
      continue;
    }

    const keys = [
      row.book.isbn && `isbn:${row.book.isbn}`,
      row.book.catalogue_id && `catalogue:${row.book.catalogue_id}`,
    ].filter(Boolean);
    if (keys.some((key) => seen.has(key))) {
      duplicates.push({ row_number: row.row_number, identifier: row.book.isbn || row.book.catalogue_id });
      displayRows.push({ ...row.book, row_number: row.row_number, status: 'DUPLICATE', reasons: ['Duplicate identifier in this file.'] });
      continue;
    }
    keys.forEach((key) => seen.add(key));
    validRows.push(row);
    displayRows.push({ ...row.book, row_number: row.row_number, status: 'NEW', reasons: [] });
  }

  return { validRows, errors, duplicates, displayRows };
}

function rowKey(value) {
  return {
    isbn: value.isbn ? normalizeIsbn(value.isbn) : null,
    catalogueId: value.catalogue_id ? value.catalogue_id.toUpperCase() : null,
  };
}

function matchExisting(row, existingRows) {
  const key = rowKey(row.book);
  const matches = existingRows.filter((book) => (
    (key.isbn && normalizeIsbn(book.isbn) === key.isbn)
    || (key.catalogueId && book.catalogue_id.toUpperCase() === key.catalogueId)
  ));
  const uniqueIds = new Set(matches.map((book) => book.id));
  if (uniqueIds.size > 1) return { conflict: true };
  return { book: matches[0] || null };
}

async function existingBooks(queryable, rows) {
  const isbns = [...new Set(rows.map((row) => row.book.isbn).filter(Boolean))];
  const catalogueIds = [...new Set(rows.map((row) => row.book.catalogue_id).filter(Boolean))];
  if (!isbns.length && !catalogueIds.length) return [];
  const result = await queryable.query(
    `SELECT id,isbn,catalogue_id,total_copies,available_copies
     FROM books
     WHERE regexp_replace(upper(isbn),'[[:space:]-]','','g')=ANY($1::text[])
        OR catalogue_id=ANY($2::text[])`,
    [isbns, catalogueIds],
  );
  return result.rows;
}

function createRouter(pool, middleware) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  const asyncRoute = (handler) => (req, res, next) => (
    Promise.resolve(handler(req, res, next)).catch(next)
  );

  router.get('/template.csv', (req, res) => {
    res.type('text/csv');
    res.set('Content-Disposition', 'attachment; filename="book-import-template.csv"');
    res.send('catalogue_id,isbn,title,author,category,publisher,publication_year,total_quantity,shelf_location\r\n');
  });
  router.get('/template.xlsx', asyncRoute(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Books');
    worksheet.addRow([
      'catalogue_id',
      'isbn',
      'title',
      'author',
      'category',
      'publisher',
      'publication_year',
      'total_quantity',
      'shelf_location',
    ]);
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="book-import-template.xlsx"');
    res.send(Buffer.from(buffer));
  }));

  router.use(middleware.auth, middleware.role('ADMIN', 'LIBRARIAN'));

  router.post('/preview', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new ImportInputError('Choose a CSV or .xlsx file to preview.');
    const rawRows = await readFileRows(req.file);
    if (!rawRows.length) throw new ImportInputError('The file contains no book rows.');
    const classified = classifyRows(rawRows);
    const foundBooks = await existingBooks(pool, classified.validRows);
    const updateIds = new Set();
    const updateErrors = [];
    for (const row of classified.validRows) {
      const match = matchExisting(row, foundBooks);
      if (match.conflict) {
        updateErrors.push({ row_number: row.row_number, reasons: ['ISBN and catalogue ID refer to different existing books.'] });
        continue;
      }
      if (!match.book) continue;
      const checkedOut = match.book.total_copies - match.book.available_copies;
      if (row.book.total_quantity < checkedOut) {
        updateErrors.push({
          row_number: row.row_number,
          reasons: [`Total quantity cannot be less than ${checkedOut} copies currently on loan.`],
        });
      } else {
        updateIds.add(match.book.id);
      }
    }
    const errors = [...classified.errors, ...updateErrors];
    const errorRows = new Set(errors.map((item) => item.row_number));
    const duplicates = classified.duplicates.length;
    const skipped = duplicates + errors.length;
    const updated = updateIds.size;
    const summary = {
      total_rows: rawRows.length,
      new_records: classified.validRows.filter((row) => {
        const match = matchExisting(row, foundBooks);
        return !match.book && !match.conflict && !errorRows.has(row.row_number);
      }).length,
      updated_records: updated,
      duplicates,
      skipped,
      validation_errors: errors.length,
    };
    const previewRows = classified.displayRows.map((item) => {
      if (errorRows.has(item.row_number)) {
        const reasons = errors.find((error) => error.row_number === item.row_number).reasons;
        return { ...item, status: 'ERROR', reasons };
      }
      if (item.status === 'NEW') {
        const match = matchExisting(classified.validRows.find((row) => row.row_number === item.row_number), foundBooks);
        if (match.book) return { ...item, status: 'UPDATE' };
      }
      return item;
    });
    res.json({
      summary,
      rows: previewRows.slice(0, 100),
      truncated: previewRows.length > 100,
      errors,
      duplicate_details: classified.duplicates,
    });
  }));

  router.post('/', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new ImportInputError('Choose a CSV or .xlsx file to import.');
    const rawRows = await readFileRows(req.file);
    if (!rawRows.length) throw new ImportInputError('The file contains no book rows.');
    const classified = classifyRows(rawRows);
    const client = await pool.connect();
    const errors = [...classified.errors];
    const counts = { imported: 0, updated: 0 };

    try {
      await client.query('BEGIN');
      for (let start = 0; start < classified.validRows.length; start += BATCH_SIZE) {
        const batch = classified.validRows.slice(start, start + BATCH_SIZE);
        for (const row of batch) {
          const { book } = row;
          const { rows: matches } = await client.query(
            `SELECT id,isbn,catalogue_id,total_copies,available_copies
             FROM books
             WHERE ($1::text IS NOT NULL AND regexp_replace(upper(isbn),'[[:space:]-]','','g')=$1)
                OR ($2::text IS NOT NULL AND catalogue_id=$2)
             FOR UPDATE`,
            [book.isbn, book.catalogue_id],
          );
          const match = matchExisting(row, matches);
          if (match.conflict) {
            errors.push({ row_number: row.row_number, reasons: ['ISBN and catalogue ID refer to different existing books.'] });
            continue;
          }

          let categoryId = null;
          if (book.category) {
            const category = await client.query(
              'SELECT id FROM categories WHERE lower(name)=lower($1) ORDER BY id LIMIT 1',
              [book.category],
            );
            if (category.rowCount) {
              categoryId = category.rows[0].id;
            } else {
              const inserted = await client.query(
                'INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
                [book.category],
              );
              categoryId = inserted.rows[0].id;
            }
          }

          if (match.book) {
            const checkedOut = match.book.total_copies - match.book.available_copies;
            if (book.total_quantity < checkedOut) {
              errors.push({
                row_number: row.row_number,
                reasons: [`Total quantity cannot be less than ${checkedOut} copies currently on loan.`],
              });
              continue;
            }
            await client.query(
              `UPDATE books SET
                 isbn=COALESCE($1,isbn),
                 title=$2,
                 author=$3,
                 publisher=COALESCE($4,publisher),
                 category_id=COALESCE($5,category_id),
                 publication_year=COALESCE($6,publication_year),
                 total_copies=$7::integer,
                 available_copies=$7::integer-$8::integer,
                 shelf_location=COALESCE($9,shelf_location),
                 updated_at=NOW()
               WHERE id=$10`,
              [
                book.isbn,
                book.title,
                book.author,
                book.publisher,
                categoryId,
                book.publication_year,
                book.total_quantity,
                checkedOut,
                book.shelf_location,
                match.book.id,
              ],
            );
            counts.updated += 1;
          } else {
            await client.query(
              `INSERT INTO books
                 (catalogue_id,isbn,title,author,publisher,category_id,publication_year,total_copies,available_copies,shelf_location)
               VALUES
                 (COALESCE($1,'LIB-'||upper(replace(gen_random_uuid()::text,'-',''))),
                  $2,$3,$4,$5,$6,$7,$8,$8,$9)`,
              [
                book.catalogue_id,
                book.isbn,
                book.title,
                book.author,
                book.publisher,
                categoryId,
                book.publication_year,
                book.total_quantity,
                book.shelf_location,
              ],
            );
            counts.imported += 1;
          }
        }
      }

      const duplicates = classified.duplicates.length;
      const skipped = duplicates + errors.length;
      const summary = {
        total_rows: rawRows.length,
        imported: counts.imported,
        updated: counts.updated,
        duplicates,
        skipped,
        validation_errors: errors.length,
      };
      const fileName = req.file.originalname.split(/[\\/]/).pop().slice(0, 255);
      await client.query(
        `INSERT INTO book_imports
           (actor_id,file_name,total_rows,imported_rows,updated_rows,duplicate_rows,skipped_rows,error_rows)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.user.id, fileName, summary.total_rows, summary.imported, summary.updated, duplicates, skipped, errors.length],
      );
      await client.query(
        `INSERT INTO audit_logs(actor_id,event_type,details)
         VALUES($1,'BOOK_BULK_IMPORT',$2::jsonb)`,
        [req.user.id, JSON.stringify({ file_name: fileName, ...summary })],
      );
      await client.query('COMMIT');
      res.json({ message: 'Book import completed.', summary, errors, duplicate_details: classified.duplicates });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  router.use((error, req, res, next) => {
    if (error instanceof ImportInputError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds the ${MAX_UPLOAD_MB} MB upload limit.`
        : 'Upload one file using the file field.';
      return res.status(status).json({ error: message });
    }
    return next(error);
  });

  return router;
}

module.exports = createRouter;
module.exports._test = {
  classifyRows,
  isValidIsbn,
  normalizeIsbn,
  normalizeText,
  readFileRows,
};
