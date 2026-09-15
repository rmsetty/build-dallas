# Build Dallas Website Repositioning

## Goal
Reframe Build Dallas as a practical coordination layer that helps DFW startups access companies, communities, programs, partners, events, and resources today—without changing the established brand identity.

## What will change

### Shared site navigation
- Replace the current tabs with Home, Companies, Resources, Events, and Get Connected.
- Remove People, Wiki, account, and matching links from public navigation.
- Keep the existing logo, dark palette, DM Serif Display and DM Sans typography, and premium visual language.
- Update the footer to reinforce the new positioning and primary destinations.

### Home
- Replace the current platform-heavy page with a shorter, focused sequence:
  1. “Build in Dallas.” hero with Explore the Ecosystem and Get Connected actions.
  2. Concise mission statement.
  3. Four What We Do items: Connect, Resources, Showcase, Community.
  4. Honest “Working across the ecosystem” partner placeholder wall.
  5. Separate “Communities building Dallas” wall with Stripe Dallas, SIP, Claude Community, and an open community slot.
  6. Logo-first company preview from available directory data, with a safe branded fallback when no logo is available.
  7. Resources for builders callout.
  8. Final “Building something in Dallas?” action.
- Remove graph, automation, matching, wiki, analytics, live workspace, and development/error messaging.

### Companies
- Simplify to a logo-first DFW company directory.
- Keep lightweight search plus industry, stage, and area filters.
- Open a focused company details dialog with name, visual mark, description, industry, stage, location, and website.
- Replace pipeline/developer empty and error messages with public-safe language.
- Add a “Submit Your Company” call to action.

### Resources
- Add a dedicated page with the ten requested resource categories.
- Add a low-friction Request a Resource dialog with the requested fields.
- Add a distinct Partner With Build Dallas action.
- Use honest language about partnerships currently being developed.

### Get Connected
- Add a dedicated page with selectable needs and the requested contact fields.
- Keep the interaction low-friction and provide a clear completion state without claiming backend delivery.

### Events
- Retain the current event data and useful date/search controls.
- Remove personalized matching, sign-in prompts, wiki/edit links, and technical empty/error text.
- Position the page around Build Dallas and community events without implying all listings are hosted by Build Dallas.

## Technical details
- Add the new route files and update all route links together so navigation remains valid.
- Reuse existing semantic colors and shared styling; add only small reusable visual/form primitives where needed.
- Keep current data reads, but ensure missing configuration or query failures render friendly public states.
- Add unique title, description, Open Graph title/description, `og:type`, and Twitter card metadata to every updated public route.
- Verify desktop and mobile layouts, dialog/form interactions, navigation, console output, and visible error states.

## Assumptions
- Partner and community marks without supplied assets will be typographic placeholders, clearly presented as ecosystem references rather than formal endorsements.
- Forms will provide an on-page confirmation for now; no persistent submission system will be added in this design-only scope.
- Existing legacy People, Wiki, Login, and Profile URLs will remain available but will no longer be promoted publicly.
