import { describe, it, expect } from 'vitest';
import { imageUrlSchema } from './schemas';

describe('imageUrlSchema', () => {
  describe('HTTPS URLs', () => {
    it('accepts valid HTTPS URLs', () => {
      const validUrls = [
        'https://example.com/image.jpg',
        'https://cdn.example.com/images/banner.png',
        'https://example.com/path/to/image.jpeg',
      ];

      for (const url of validUrls) {
        const result = imageUrlSchema.safeParse(url);
        expect(result.success).toBe(true);
      }
    });

    it('rejects HTTP URLs', () => {
      const result = imageUrlSchema.safeParse('http://example.com/image.jpg');
      expect(result.success).toBe(false);
    });

    it('rejects non-HTTPS protocols', () => {
      const invalidUrls = [
        'ftp://example.com/image.jpg',
        'file:///path/to/image.jpg',
        'data:text/html,<h1>test</h1>',
      ];

      for (const url of invalidUrls) {
        const result = imageUrlSchema.safeParse(url);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('Base64 Data URLs', () => {
    it('accepts valid JPEG data URLs', () => {
      // Small valid JPEG base64 (1x1 pixel red JPEG)
      const jpegDataUrl =
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA==';
      
      const result = imageUrlSchema.safeParse(jpegDataUrl);
      expect(result.success).toBe(true);
    });

    it('accepts valid PNG data URLs', () => {
      // Small valid PNG base64 (1x1 pixel transparent PNG)
      const pngDataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      
      const result = imageUrlSchema.safeParse(pngDataUrl);
      expect(result.success).toBe(true);
    });

    it('rejects data URLs with unsupported formats', () => {
      const invalidFormats = [
        'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
        'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      ];

      for (const dataUrl of invalidFormats) {
        const result = imageUrlSchema.safeParse(dataUrl);
        expect(result.success).toBe(false);
      }
    });

    it('rejects data URLs that are too large (>2MB)', () => {
      // Create a base64 string that exceeds 2MB when decoded
      // Base64 encoding adds ~33% overhead, so we need a string that decodes to >2MB
      // For a 2MB limit, the base64 string should be roughly 2.67MB (2MB * 4/3)
      const largeBase64 = 'A'.repeat(3 * 1024 * 1024); // 3MB of base64 data
      const largeDataUrl = `data:image/jpeg;base64,${largeBase64}`;
      
      const result = imageUrlSchema.safeParse(largeDataUrl);
      expect(result.success).toBe(false);
    });

    it('rejects malformed data URLs', () => {
      const malformedUrls = [
        'data:image/jpeg,notbase64',
        'data:image/jpeg;base64',
        'data:text/plain;base64,SGVsbG8=',
        'data:jpeg;base64,/9j/4AAQ...',
      ];

      for (const dataUrl of malformedUrls) {
        const result = imageUrlSchema.safeParse(dataUrl);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('Edge cases', () => {
    it('rejects empty strings', () => {
      const result = imageUrlSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('rejects whitespace-only strings', () => {
      const result = imageUrlSchema.safeParse('   ');
      expect(result.success).toBe(false);
    });

    it('trims input before validation', () => {
      const result = imageUrlSchema.safeParse('  https://example.com/image.jpg  ');
      expect(result.success).toBe(true);
    });
  });
});
