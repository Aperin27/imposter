# Stage 4 question bank — editorial review

## Composition

**250 active pairs / 500 prompts**, with permanent unique IDs. The ten owner-approved examples are the first ten records and retain their exact wording and order of questions. The other **240 pairs are original additions** written for this project; no online question collection was copied.

| Category | Active pairs | Share |
| --- | ---: | ---: |
| Friendship, loyalty and trust (`friendship`) | 32 | 12.8% |
| Dating, relationships and awkward situations (`dating`) | 32 | 12.8% |
| Embarrassing personal habits (`habits`) | 31 | 12.4% |
| Social situations and moral dilemmas (`social`) | 31 | 12.4% |
| Hypothetical scenarios and difficult choices (`hypothetical`) | 31 | 12.4% |
| Funny opinions and unpopular preferences (`opinions`) | 31 | 12.4% |
| Absurd but believable situations (`absurd`) | 31 | 12.4% |
| Numerical overlaps (`numerical`) | 31 | 12.4% |
| **Total** | **250** | **100%** |

There are **31 numerical pairs (12.4%)**; none of the other categories uses a numerical answer format. The answer-domain counts are `opinion` 36, `item` 61, `food` 8, `person` 13, `number` 31, `phrase` 52, `activity` 41, `place` 8. These are editorial labels, not input validators: players may still submit any short answer accepted by the established game rules. `item` includes named things such as products, apps, animals, songs and sounds where both sides ask for the same kind of thing.

## Compatibility and maintenance

- `worker/questions.ts` remains backend-only. The gameplay payload must continue to contain just the current player's allocated question until the public reveal.
- `QuestionPair` retains `id` and the two-string `questions` tuple. `category` and `answerType` are optional in the TypeScript interface so small synthetic fixtures remain compatible, but every active record supplies both.
- All original 18 Stage 1 pairs are **retired from the active bank**, rather than repurposing their IDs. Their frozen `LEGACY_QUESTION_IDS` mapping remains intact, and saved rounds retain their original text snapshots. No deployed question ID has been reused.
- Keep a new ID permanently attached to its pair once published. A substantially different concept needs a new ID; retiring or reordering a record must not reassign an old ID.
- “Normal” and “imposter” in the approved examples describe their original source order. Both sides were reviewed as symmetric answer domains so the server may randomize the orientation of new rounds.
- This is a new global rotation's active bank, not evidence of what was used historically in untracked rooms.

## Editorial quality control

Every pair received a first author review and an independent full-bank read by another agent. The review considered answer format, natural answer overlap, reveal value, near-duplicate concepts, comprehension and tone. Sixteen initial records were revised or replaced during self-review and independent review; a further vocabulary refinement removed “coat of arms” in favour of “welcome sign”.

Examples of concrete fixes:

- Replaced romantic-person/job labels with vague replies about love life/job, removing an incompatible person-versus-occupation answer domain.
- Replaced home/phone actions with home/car actions, which naturally share eating, smoking, music and bringing other people.
- Replaced pet/houseplant treatment with guest/stranger treatment of the same pet; both sides now naturally yield touching, feeding, picking up or letting outside.
- Replaced repeated “boring chores”, personal sponsorship and “ordinary achievement deserves applause/statue” concepts with distraction objects, justified purchases and unlikely town/hotel emblems.
- Sharpened near-identical day-off, tourism, smell and embarrassing-memory prompts into questions with different motivations and overlapping answers.
- Removed specialist heraldry wording. No prompts require trivia facts, local prices, knowledge of a specific celebrity or a particular country's rules. Celebrity answers are chosen by players; money answers use the group's own currency.

Objective content checks cover exactly 250 unique IDs, all 500 question texts nonempty and distinct after normalization, unequal sides within each pair, eight balanced categories, 31 numerical formats, ten approved examples preserved, and the frozen 18-ID legacy mapping. Semantic overlap and humour are editorial judgments rather than properties a unit test can prove.

No physical group playtest has been performed. Some groups may converge on the same answer to very close prompts; other groups may produce outliers because of personal circumstances or culture. The design deliberately permits plausible outliers rather than guaranteeing that every answer is equally likely. Keep genuinely weak pairs out of future releases based on observed play, without changing the identities of already published pairs.

## Twenty strongest original additions for owner review

This is an editorial shortlist, not a statistical ranking. It excludes the ten examples supplied in the brief.

| # | Permanent ID | Question A | Question B |
| ---: | --- | --- | --- |
| 1 | `friendship-group-chat-name` | What would be an honest name for your group chat? | What would be an honest title for a documentary about your friends? |
| 2 | `friendship-harmless-betrayal` | What's the smallest thing a friend could do that would feel like betrayal? | What's the smallest thing a roommate could do that would start a feud? |
| 3 | `friendship-compliment` | What's a compliment from a friend that is secretly an insult? | What's an insult from a friend that you would secretly take as a compliment? |
| 4 | `friendship-distrust-kit` | What item would a friend bring to a picnic that proves they don't trust your planning? | What item would a friend bring on holiday that proves they don't trust your packing? |
| 5 | `dating-first-message` | What's the worst opening message you could send a dating match? | What's the worst opening message you could send a new colleague? |
| 6 | `dating-low-effort-romance` | What's the laziest gesture that could still count as romantic? | What's the laziest gesture that could still count as an apology? |
| 7 | `dating-unhelpful-wingman` | What's the worst thing a friend could say while introducing you to your crush? | What's the worst thing a friend could say while introducing you to their parents? |
| 8 | `dating-pet-name` | What's the worst affectionate nickname someone could give you? | What's the worst nickname your colleagues could start calling you? |
| 9 | `habits-laundry-logic` | What excuse do you use to decide clothes are still clean enough? | What excuse do you use to decide leftovers are still fine? |
| 10 | `habits-status-lie` | What does 'I'm nearly ready' usually mean when you say it? | What does 'I'm leaving now' usually mean when you say it? |
| 11 | `habits-shopping-fiction` | What do you buy for the imaginary organised version of yourself? | What do you buy for the imaginary outdoorsy version of yourself? |
| 12 | `social-changed-plan` | What sentence makes a simple group plan suddenly exhausting? | What sentence makes a quick work meeting suddenly exhausting? |
| 13 | `social-last-minute-invite` | What wording makes an invitation sound like you were an afterthought? | What wording makes a compliment sound like an obligation? |
| 14 | `hypothetical-customer-review` | What would be the title of a one-star review of your personality? | What would be the title of a one-star review of your home? |
| 15 | `hypothetical-justified-purchase` | What everyday purchase do you always convince yourself is an investment? | What everyday purchase do you always convince yourself will save time? |
| 16 | `opinions-fake-fancy` | What word makes an ordinary product sound unnecessarily expensive? | What word makes an ordinary job sound unnecessarily important? |
| 17 | `opinions-best-day-off` | What should count as exercise even though it doesn't? | What should count as a hobby even though it doesn't? |
| 18 | `absurd-pet-review` | What complaint would your pet make in a review of you? | What complaint would a houseplant make in a review of you? |
| 19 | `absurd-personal-warning` | What warning label should come attached to you? | What warning label should come attached to your home? |
| 20 | `numerical-awkward-silence` | How many seconds of silence make a conversation awkward? | How many seconds of eye contact make a friendly smile awkward? |

## Suggested owner acceptance

Play several short cases with different groups. In review, ask whether each player's answer could reasonably fit either prompt before reading the alternate question. Note confusing vocabulary, automatic giveaways and repeated concepts by permanent ID. No vote, scoring rule, category filter or extra UI was introduced as part of this content expansion.
