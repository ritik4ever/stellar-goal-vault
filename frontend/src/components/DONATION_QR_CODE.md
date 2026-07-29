# Donation QR Code Feature

## Overview

The Donation QR Code feature allows campaign creators to share their Stellar address via QR code, making it easy for supporters to donate using any Stellar wallet application.

## Implementation

### Component: `DonationQRCode.tsx`

Located in `frontend/src/components/DonationQRCode.tsx`, this component:

- Generates a QR code encoding the campaign creator's Stellar address
- Displays the QR code with clear instructions for scanning
- Shows the full Stellar address below the QR code
- Provides a download button to save the QR code as PNG

### Integration

The component is integrated into the `CampaignDetailPanel` component and appears on every campaign detail page, positioned between the campaign image and external link sections.

## Features

### QR Code Generation
- Uses the `qrcode` library for reliable QR code generation
- Error correction level: High (H) - allows scanning even if partially damaged
- Size: 200x200 pixels with appropriate margins
- Colors: Dark blue (#0f172a) on white background for high contrast

### User Experience
- **Scan Instructions**: Clear caption "Scan to donate via any Stellar wallet"
- **Address Display**: Full Stellar address shown below QR code for verification
- **Download Functionality**: One-click download as `campaign_donate_qr.png`
- **Wallet Compatibility**: Works with Lobstr, Solar, and other Stellar wallets

### Styling
- Responsive design that adapts to mobile and desktop screens
- Matches the application's design system with glass morphism effects
- Accessible color contrast ratios
- Clean, modern appearance with rounded corners and shadows

## Usage

### For Campaign Creators
1. Navigate to your campaign detail page
2. Scroll to the "Scan to Donate" section
3. Share the QR code by:
   - Letting supporters scan it directly from your screen
   - Downloading the PNG and sharing it on social media
   - Including it in promotional materials

### For Donors
1. Open your Stellar wallet app (Lobstr, Solar, etc.)
2. Use the "Scan" or "Send" feature
3. Scan the QR code
4. Confirm the transaction in your wallet

## Technical Details

### Dependencies
- `qrcode`: ^1.5.3 - QR code generation library
- `@types/qrcode`: ^1.5.5 - TypeScript definitions

### Props
```typescript
interface DonationQRCodeProps {
  stellarAddress: string;  // The creator's Stellar public key
  campaignTitle: string;   // Campaign name (for context)
}
```

### Acceptance Criteria
✅ QR code encodes correct Stellar address
✅ Scannable by Lobstr, Solar, and other Stellar wallets  
✅ Download saves as `campaign_donate_qr.png`
✅ Clear caption: "Scan to donate via any Stellar wallet"
✅ Displays on campaign detail page

## Testing

### Unit Tests
- Component rendering and structure
- QR code generation with correct parameters
- Download functionality
- Address display
- Style class application
- Re-rendering on address change

### Accessibility Tests
- No ARIA violations
- Proper ARIA labels on interactive elements
- Correct heading hierarchy

### Test Files
- `DonationQRCode.test.tsx` - Unit tests
- `DonationQRCode.a11y.test.tsx` - Accessibility tests
- `DonationQRCode.stories.tsx` - Storybook stories

## Browser Compatibility

The component uses standard web APIs and is compatible with:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

Potential improvements for future iterations:
- Custom QR code colors matching campaign theme
- Multiple size options for different use cases
- Social media share buttons
- Print-friendly version
- QR code with embedded logo
- Analytics tracking for QR code scans
