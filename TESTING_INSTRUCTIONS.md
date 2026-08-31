# Campaign Image Upload - Testing Instructions

## Prerequisites

1. **Install Dependencies**
   ```bash
   # Backend
   cd backend
   npm install
   
   # Frontend  
   cd frontend
   npm install
   ```

2. **Prepare Test Images**
   Download or create these test images:
   - `valid-small.jpg` - Small JPEG (< 1MB)
   - `valid-small.png` - Small PNG (< 1MB)
   - `oversized.jpg` - Large JPEG (> 2MB)
   - `invalid.gif` - GIF file
   - `invalid.webp` - WebP file

## Part 1: Backend Validation Tests

### Run Unit Tests
```bash
cd backend
npm run test
```

**Expected Results**:
- ✅ All tests pass
- ✅ `imageUrl.test.ts` tests pass:
  - HTTPS URL validation
  - Base64 JPEG/PNG acceptance
  - Size limit enforcement (2MB)
  - Format rejection (GIF, WebP, SVG)
  - Malformed URL rejection

### Manual API Testing (Optional)

1. **Start Backend**
   ```bash
   cd backend
   npm run dev
   ```

2. **Test Valid Base64 Image**
   ```bash
   curl -X POST http://localhost:3000/api/campaigns \
     -H "Content-Type: application/json" \
     -d '{
       "creator": "GABC...XYZ56",
       "title": "Test Campaign with Image",
       "description": "Testing base64 image upload functionality",
       "acceptedTokens": ["USDC"],
       "targetAmount": 100,
       "deadline": 1735689600,
       "metadata": {
         "imageUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD..."
       }
     }'
   ```
   
   **Expected**: `201 Created` with campaign data

3. **Test Invalid Format**
   ```bash
   curl -X POST http://localhost:3000/api/campaigns \
     -H "Content-Type: application/json" \
     -d '{
       ...
       "metadata": {
         "imageUrl": "data:image/gif;base64,R0lGOD..."
       }
     }'
   ```
   
   **Expected**: `400 Bad Request` with validation error

## Part 2: Frontend Unit Tests

```bash
cd frontend
npm run test
```

**Expected Results**:
- ✅ All existing tests pass
- ✅ No TypeScript errors
- ✅ No linting errors

## Part 3: End-to-End Manual Testing

### Setup
1. **Start Backend**
   ```bash
   cd backend
   npm run dev
   ```

2. **Start Frontend**
   ```bash
   cd frontend  
   npm run dev
   ```

3. **Open Browser**
   Navigate to `http://localhost:5173` (or configured port)

---

### Test Case 1: Valid JPEG Upload

**Steps**:
1. Navigate to "Create Campaign" form
2. Fill in required fields (creator, title, description, etc.)
3. Click "Choose File" under "Campaign Image"
4. Select `valid-small.jpg` (< 2MB)
5. Observe preview appears
6. Click "Create campaign"
7. Navigate to campaign list
8. Click "Manage" on new campaign

**Expected Results**:
- ✅ File picker accepts selection
- ✅ No error message appears
- ✅ Image preview displays correctly
- ✅ Form submits successfully
- ✅ Campaign card shows banner image
- ✅ Campaign detail shows full-width banner
- ✅ Image quality is acceptable

**Pass/Fail**: ⬜

---

### Test Case 2: Valid PNG Upload

**Steps**:
1. Navigate to "Create Campaign" form
2. Fill in required fields
3. Click "Choose File"
4. Select `valid-small.png` (< 2MB)
5. Observe preview appears
6. Submit and verify display

**Expected Results**:
- ✅ PNG file accepted
- ✅ Preview renders correctly
- ✅ Submission successful
- ✅ Displays on card and detail page

**Pass/Fail**: ⬜

---

### Test Case 3: Oversized File Rejection

**Steps**:
1. Navigate to "Create Campaign" form
2. Fill in required fields
3. Click "Choose File"
4. Select `oversized.jpg` (> 2MB)

**Expected Results**:
- ✅ Error message: "Image must be smaller than 2MB"
- ✅ No preview appears
- ✅ File input clears
- ✅ Cannot submit form with this image

**Pass/Fail**: ⬜

---

### Test Case 4: Invalid Format Rejection (GIF)

**Steps**:
1. Navigate to "Create Campaign" form
2. Click "Choose File"
3. Try to select `invalid.gif`

**Expected Results**:
- ✅ File picker may not show GIF (filtered by accept attribute)
- OR
- ✅ Error message: "Only JPG and PNG images are allowed"
- ✅ No preview appears

**Pass/Fail**: ⬜

---

### Test Case 5: Invalid Format Rejection (WebP)

**Steps**:
1. Navigate to "Create Campaign" form
2. Click "Choose File"
3. Try to select `invalid.webp`

**Expected Results**:
- ✅ Error message: "Only JPG and PNG images are allowed"
- ✅ No preview appears

**Pass/Fail**: ⬜

---

### Test Case 6: Image Preview and Remove

**Steps**:
1. Navigate to "Create Campaign" form
2. Upload `valid-small.jpg`
3. Verify preview appears
4. Click "Remove image" button
5. Observe image preview disappears
6. Verify can upload again

**Expected Results**:
- ✅ Preview shows uploaded image
- ✅ Remove button visible
- ✅ Click removes preview
- ✅ File input re-enabled
- ✅ Can select new image

**Pass/Fail**: ⬜

---

### Test Case 7: HTTPS URL Still Works

**Steps**:
1. Navigate to "Create Campaign" form
2. Fill required fields
3. **Do not** upload a file
4. Enter in Image URL: `https://picsum.photos/400/280`
5. Submit form
6. View created campaign

**Expected Results**:
- ✅ Form accepts URL
- ✅ Submission successful
- ✅ Card displays image from URL
- ✅ Detail page displays image from URL

**Pass/Fail**: ⬜

---

### Test Case 8: Mutual Exclusivity (File vs URL)

**Steps**:
1. Navigate to "Create Campaign" form
2. Upload `valid-small.jpg`
3. Observe Image URL input is disabled
4. Click "Remove image"
5. Observe Image URL input is enabled
6. Enter HTTPS URL
7. Observe file input is disabled

**Expected Results**:
- ✅ Can't use both upload and URL simultaneously
- ✅ Inputs properly enable/disable based on selection
- ✅ Clear communication of mutual exclusivity

**Pass/Fail**: ⬜

---

### Test Case 9: Gradient Fallback (No Image)

**Steps**:
1. Create campaign without any image
2. View campaign card in list
3. View campaign detail page

**Expected Results**:
- ✅ Card shows purple gradient banner (no broken icon)
- ✅ Detail page shows purple gradient banner
- ✅ Gradient: indigo (#6366f1) to purple (#a855f7)
- ✅ Visual design is clean and professional

**Pass/Fail**: ⬜

---

### Test Case 10: Image Load Error Fallback

**Steps**:
1. Create campaign with URL: `https://invalid.domain.xyz/image.jpg`
2. View campaign card
3. View campaign detail page

**Expected Results**:
- ✅ Card shows gradient fallback (not broken image icon)
- ✅ Detail page shows gradient fallback
- ✅ No console errors
- ✅ Graceful degradation

**Pass/Fail**: ⬜

---

## Part 4: Cross-Browser Testing

Test critical flows in multiple browsers:

### Browsers to Test
- ⬜ Chrome/Edge (Chromium)
- ⬜ Firefox
- ⬜ Safari (Mac/iOS)

### Critical Flows
For each browser:
1. ⬜ Upload valid JPEG
2. ⬜ Upload valid PNG
3. ⬜ Reject oversized file
4. ⬜ Preview displays correctly
5. ⬜ Card banner renders
6. ⬜ Detail banner renders
7. ⬜ Gradient fallback works

---

## Part 5: Responsive Testing

### Mobile (< 640px)
1. Open DevTools, set to iPhone viewport
2. Test upload flow
3. Verify card banner displays at correct size
4. Verify detail banner displays correctly
5. Verify touch targets are adequate

**Expected**:
- ⬜ Upload UI is usable on mobile
- ⬜ Banners scale appropriately
- ⬜ No horizontal scroll
- ⬜ Touch targets minimum 44x44px

### Tablet (640px - 1024px)
1. Set viewport to iPad size
2. Verify layout and interactions

**Expected**:
- ⬜ Layout adjusts properly
- ⬜ Images display correctly

### Desktop (> 1024px)
1. Test at 1920x1080
2. Test at 2560x1440

**Expected**:
- ⬜ Optimal layout at all sizes
- ⬜ Images don't appear pixelated

---

## Part 6: Accessibility Testing

### Keyboard Navigation
1. ⬜ Tab to file input → Space/Enter opens picker
2. ⬜ Tab to remove button → Space/Enter removes image
3. ⬜ All form controls reachable via keyboard
4. ⬜ No keyboard traps

### Screen Reader Testing (Optional)
1. Enable screen reader (NVDA, JAWS, VoiceOver)
2. Navigate form
3. Verify announcements:
   - ⬜ File input purpose is clear
   - ⬜ Validation errors are announced
   - ⬜ Image alt text is meaningful

### Color Contrast
1. ⬜ Error messages have sufficient contrast
2. ⬜ Gradient fallback is not relied upon for information
3. ⬜ All text readable

---

## Part 7: Performance Testing

### File Processing
1. Upload 1.9MB image
2. Measure time to preview
3. Measure time to submit

**Expected**:
- ⬜ Preview appears < 2 seconds
- ⬜ Submit completes < 5 seconds
- ⬜ No browser freeze/lag

### Database Size
1. Create 10 campaigns with 2MB images
2. Check database file size
3. Query campaign list performance

**Expected**:
- ⬜ Database grows as expected
- ⬜ No performance degradation
- ⬜ Queries remain fast (< 100ms)

---

## Part 8: Security Testing

### Validation Bypass Attempts

**Test 1: Modified File Extension**
1. Rename `malicious.exe` to `image.jpg`
2. Try to upload

**Expected**: ⬜ Rejected (MIME type check)

**Test 2: Oversized Base64 in Request**
1. Manually craft POST request with >2MB base64
2. Send to API

**Expected**: ⬜ 400 Bad Request

**Test 3: Invalid Data URL Format**
1. Send malformed data URL: `data:image/jpeg,notbase64`
2. Verify rejection

**Expected**: ⬜ 400 Bad Request

**Test 4: XSS Attempt**
1. Try to upload SVG with `<script>` tag
2. Verify rejection

**Expected**: ⬜ Rejected (SVG not in allowed formats)

---

## Test Results Summary

### Backend Tests
- Unit tests: ⬜ Pass / ⬜ Fail
- API validation: ⬜ Pass / ⬜ Fail

### Frontend Tests  
- Unit tests: ⬜ Pass / ⬜ Fail
- Linting: ⬜ Pass / ⬜ Fail

### E2E Manual Tests
- Valid uploads: ⬜ Pass / ⬜ Fail
- Validation errors: ⬜ Pass / ⬜ Fail
- Display (cards): ⬜ Pass / ⬜ Fail
- Display (detail): ⬜ Pass / ⬜ Fail
- Fallback gradient: ⬜ Pass / ⬜ Fail

### Cross-Browser
- Chrome/Edge: ⬜ Pass / ⬜ Fail
- Firefox: ⬜ Pass / ⬜ Fail
- Safari: ⬜ Pass / ⬜ Fail

### Responsive
- Mobile: ⬜ Pass / ⬜ Fail
- Tablet: ⬜ Pass / ⬜ Fail
- Desktop: ⬜ Pass / ⬜ Fail

### Accessibility
- Keyboard nav: ⬜ Pass / ⬜ Fail
- Screen reader: ⬜ Pass / ⬜ Fail
- Color contrast: ⬜ Pass / ⬜ Fail

### Performance
- File processing: ⬜ Pass / ⬜ Fail
- Database impact: ⬜ Pass / ⬜ Fail

### Security
- Validation bypass: ⬜ Pass / ⬜ Fail

---

## Issues Found

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| 1 |          |             |        |
| 2 |          |             |        |
| 3 |          |             |        |

---

## Sign-Off

**Tester Name**: _________________

**Date**: _________________

**Overall Result**: ⬜ PASS / ⬜ FAIL / ⬜ PASS WITH ISSUES

**Notes**:
_______________________________________________
_______________________________________________
_______________________________________________
