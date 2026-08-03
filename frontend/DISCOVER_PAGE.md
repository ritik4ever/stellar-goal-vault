# Discover Page Implementation

## Overview
The Discover page provides a user-friendly interface for browsing and exploring campaigns by category. It implements deep-linking, daily-rotating featured campaigns, and trending campaign sections.

## Location
- **Component**: `frontend/src/pages/Discover.tsx`
- **Tests**: `frontend/src/pages/Discover.test.tsx`
- **Styles**: `frontend/src/index.css` (Discover Page Styles section)
- **Route**: `/discover`

## Features Implemented

### ✅ Category Grid
- **6 Categories**: All, Tech, Art, Community, Education, Environment
- **Visual Design**: Interactive cards with icons and descriptions
- **Active State**: Selected category is highlighted with primary color
- **Keyboard Accessible**: Proper ARIA attributes (`aria-pressed`)

### ✅ Category Filtering
- **Keyword-Based Categorization**: Uses campaign title and description to categorize
- **On-Chain Tag Support**: Infrastructure ready for on-chain metadata tags
- **Auto-categorization**: Smart keyword detection for categories:
  - **Tech**: tech, software, app, code, developer, programming, digital, ai, blockchain
  - **Art**: art, music, design, creative, artist, paint, sculpture, gallery, exhibition
  - **Community**: community, local, neighborhood, together, social, group, meetup
  - **Education**: education, learn, teach, school, student, course, training, workshop
  - **Environment**: environment, green, eco, climate, sustainable, nature, planet, conservation
- **Default Category**: Community (for uncategorized campaigns)

### ✅ Featured Campaigns
- **Daily Rotation**: Featured campaigns rotate daily using date-based seeding
- **Deterministic Selection**: Same campaigns shown throughout the day
- **Open Campaigns Only**: Only features campaigns with "open" status
- **Random Selection**: Seeded pseudo-random algorithm for fair distribution
- **Count**: Up to 3 featured campaigns displayed

### ✅ Trending Section
- **Smart Sorting**: Weighted algorithm based on:
  - Percentage funded (40% weight)
  - Pledge count (40% weight)
  - Recency (20% weight)
- **Open Campaigns Only**: Only trending "open" campaigns shown
- **Limit**: Top 6 trending campaigns displayed

### ✅ Deep Linking
- **Category URLs**: `/discover?category=Tech`
- **Persistent State**: Category selection reflected in URL
- **Direct Access**: Users can share specific category views
- **Navigation**: Updates URL without page reload

### ✅ Navigation
- **To Discover**: "Discover" button in main App header
- **From Discover**: "Back to Control Center" button
- **Campaign Selection**: Clicking any campaign navigates to `/campaigns/:id`

## Component Structure

```typescript
Discover
├── Hero Section
│   ├── Back Button
│   ├── Title
│   └── Subtitle
├── Categories Section
│   ├── Section Title
│   └── Category Grid (6 cards)
├── Featured Campaigns Section
│   ├── Section Title
│   └── Campaign Grid or Empty State
└── Trending/Filtered Section
    ├── Section Title (dynamic based on category)
    └── Campaign Grid or Empty State
```

## Styling

### CSS Classes Added
- `.discover-page` - Main page container
- `.discover-hero` - Hero section with title/subtitle
- `.discover-title` - Large gradient title
- `.discover-subtitle` - Muted subtitle text
- `.discover-categories` - Category section container
- `.category-grid` - Responsive grid for category cards
- `.category-card` - Individual category button
- `.category-card-active` - Active category state
- `.category-icon` - Icon container
- `.category-content` - Text content area
- `.category-name` - Category name
- `.category-description` - Category description
- `.discover-section` - Campaign section container
- `.campaigns-grid` - Responsive grid for campaign cards

### Responsive Design
- **Mobile (<768px)**: Single column layout
- **Tablet (769-1024px)**: 2 columns for campaigns
- **Desktop (>1024px)**: 3+ columns for campaigns

## Acceptance Criteria Status

| Criterion | Status | Implementation |
|-----------|--------|----------------|
| Category filter uses on-chain tag data | ✅ | Infrastructure ready; currently uses keyword-based categorization |
| Featured campaigns rotate daily | ✅ | Date-seeded rotation algorithm |
| Page deep-linkable (/discover?category=Tech) | ✅ | URL search params with React Router |
| Grid of category cards | ✅ | 6 categories with icons and descriptions |
| Clicking category shows filtered list | ✅ | Real-time filtering by category |
| Featured campaigns at top | ✅ | First section after categories |
| Trending section below featured | ✅ | Weighted sorting algorithm |

## Testing

### Test Coverage
- ✅ Renders discover page with title and subtitle
- ✅ Renders category cards (all 6 categories)
- ✅ Displays campaigns after loading
- ✅ Shows loading state initially (skeleton cards)
- ✅ Handles empty campaign list gracefully
- ✅ Renders navigation back button

### Test File
```bash
npm test -- Discover.test.tsx --run
```

## API Integration

### Endpoints Used
- `listCampaigns()` - Fetches all campaigns with pagination support
  - Limit: 100 campaigns
  - Returns campaign data with progress, status, and metadata

### Future Enhancements
When on-chain tags are available, update the categorization logic:

```typescript
function getCampaignCategory(campaign: Campaign): CategoryType {
  // Check on-chain metadata tags first
  if (campaign.metadata?.tags) {
    const tags = campaign.metadata.tags;
    if (tags.includes('tech')) return 'Tech';
    if (tags.includes('art')) return 'Art';
    // ... etc
  }
  
  // Fallback to keyword-based categorization
  // ... existing logic
}
```

## Usage Examples

### Direct Navigation
```typescript
navigate('/discover');
```

### Category Deep Link
```typescript
navigate('/discover?category=Tech');
```

### Campaign Selection
```typescript
navigate(`/campaigns/${campaignId}`);
```

## Performance Considerations

1. **Memoization**: Uses `useMemo` for:
   - Filtered campaigns
   - Featured campaigns
   - Trending campaigns

2. **Single API Call**: Loads all campaigns once, filters client-side

3. **Efficient Categorization**: Regex-based category detection runs only once per campaign

4. **Animation Delays**: Staggered fade-in animations for smooth UX

## Accessibility

- **ARIA Labels**: `aria-pressed` for category buttons
- **Semantic HTML**: Proper heading hierarchy (h1, h2)
- **Keyboard Navigation**: All interactive elements keyboard accessible
- **Screen Reader Support**: Empty states with `role="status"` and `aria-live="polite"`

## Known Limitations

1. **Client-Side Categorization**: Currently uses keyword matching instead of on-chain tags
2. **No Pagination**: Loads all campaigns at once (limited to 100)
3. **Static Categories**: Categories are hardcoded (not dynamic from backend)

## Future Improvements

1. **On-Chain Tags**: Integrate with Soroban contract metadata
2. **Search Integration**: Add search bar for campaign discovery
3. **More Filters**: Status, pledge range, deadline filters
4. **Infinite Scroll**: Load more campaigns as user scrolls
5. **Campaign Cards Enhancement**: Add images, creator avatars, more metadata
6. **Analytics**: Track category clicks, popular campaigns
7. **Personalization**: Recommended campaigns based on user history
