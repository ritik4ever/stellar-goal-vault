## Summary

- Smoothly animates the campaign progress bar when funding percentage changes after a pledge
- Uses 0.4s cubic-bezier transition for responsive feel
- Animation only triggers on update, not on initial page load

## Changes

- **CampaignCard.tsx**: Added useRef to track previous percent and useState to conditionally apply animation class after initial render
- **index.css**: Added `.progress-bar-fill` class with CSS transition on width

## Acceptance criteria

- Progress bar animates on funding percentage change
- Animation duration is short enough to feel responsive  
- Animation does not trigger on initial page load