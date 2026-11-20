import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import multer from 'multer';
import unzipper from 'unzipper';
import { config } from '../config';
import { logger } from '../logger';
import { AppError } from '../middlewares/errorHandler';

const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024; // 150 MB uncompressed safety cap
const MAX_ZIP_ENTRIES = 10_000;

// Ensure upload directory exists
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

// Multer disk storage setup
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload-${uniqueSuffix}${ext}`);
  },
});

// File filter: accept only .zip files
const fileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const isZip =
    file.mimetype === 'application/zip' ||
    file.mimetype === 'application/x-zip-compressed' ||
    file.originalname.toLowerCase().endsWith('.zip');

  if (isZip) {
    cb(null, true);
  } else {
    cb(new AppError('Only .zip archive files are supported', 400, 'INVALID_FILE_TYPE'));
  }
};

export const uploadZipMiddleware = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB maximum zip upload size
  },
  fileFilter,
});

function shouldSkipZipEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return true;
  if (segments[0] === '__MACOSX') return true;
  if (segments.includes('.git')) return true;
  if (segments[segments.length - 1] === '.DS_Store') return true;
  return false;
}

export class StorageService {
  /**
   * Safely extracts a zip archive into a destination directory,
   * with strict Zip Slip path boundary verification, zip-bomb size/entry limits,
   * and filtering of .git / __MACOSX metadata so Git diff tracking initializes cleanly.
   */
  static async extractZip(zipFilePath: string, targetDir: string): Promise<void> {
    logger.info(`Extracting zip ${zipFilePath} into ${targetDir}`);
    await fsp.mkdir(targetDir, { recursive: true });

    const resolvedTarget = path.resolve(targetDir);
    const targetPrefix = `${resolvedTarget}${path.sep}`;

    const directory = await unzipper.Open.file(zipFilePath);
    if (directory.files.length > MAX_ZIP_ENTRIES) {
      throw new AppError(
        `Zip archive exceeds maximum allowed entry count (${MAX_ZIP_ENTRIES})`,
        400,
        'ZIP_TOO_LARGE',
      );
    }

    let extractedBytes = 0;

    for (const file of directory.files) {
      if (shouldSkipZipEntry(file.path)) {
        continue;
      }

      // Guard against Zip Slip attacks (including sibling-prefix bypasses)
      const destinationPath = path.resolve(resolvedTarget, file.path);
      if (destinationPath !== resolvedTarget && !destinationPath.startsWith(targetPrefix)) {
        logger.error(`Suspicious zip entry prevented: ${file.path}`);
        throw new AppError(
          `Zip entry attempts directory traversal: ${file.path}`,
          400,
          'SECURITY_VIOLATION',
        );
      }

      if (file.type === 'Directory') {
        await fsp.mkdir(destinationPath, { recursive: true });
      } else {
        const parentDir = path.dirname(destinationPath);
        await fsp.mkdir(parentDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
          const readStream = file.stream();
          const writeStream = fs.createWriteStream(destinationPath);

          readStream.on('data', (chunk: Buffer) => {
            extractedBytes += chunk.length;
            if (extractedBytes > MAX_EXTRACTED_BYTES) {
              readStream.destroy();
              writeStream.destroy();
              reject(
                new AppError(
                  'Zip archive exceeds maximum uncompressed size limit (150 MB)',
                  400,
                  'ZIP_TOO_LARGE',
                ),
              );
            }
          });

          readStream.on('error', reject);
          writeStream.on('error', reject);
          writeStream.on('finish', () => resolve());
          readStream.pipe(writeStream);
        });
      }
    }

    logger.info(`Successfully extracted zip archive to ${targetDir}`);
  }

  /**
   * Deletes a temporary uploaded file.
   */
  static async removeUploadedFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fsp.unlink(filePath);
        logger.debug(`Removed temporary upload: ${filePath}`);
      }
    } catch (err) {
      logger.warn(`Failed to remove file ${filePath}:`, err);
    }
  }
}
