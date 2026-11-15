# Cribbage rules (standard two-player, six-card game)

This is the rules reference for this project. The rules engine, the UI and the
tests must all agree with it. If code or an issue disagrees with this file,
treat that as a bug and raise it.

It describes the standard two-player six-card game played to 121. Table
etiquette and tournament procedure (misdeals, penalties, how to physically cut)
are left out because the software deals, enforces and counts automatically.

## 1. Overview

- **Players:** 2.
- **Cards:** one standard 52-card deck, no jokers.
- **Goal:** be the first to score **121** points.
- **Score keeping:** a cribbage board with two pegs per player (see section 9).
- A game is a series of **hands** (deals). Each hand has four stages, always in
  this order:
  1. Deal and discard to the crib
  2. Cut the starter card
  3. The play (pegging)
  4. The show (counting the hands and the crib)

Terms used below:

| Term | Meaning |
|---|---|
| Dealer | The player who dealt this hand. Owns the crib. |
| Pone | The non-dealer. Leads the play and counts first. |
| Crib | Four cards (two discarded by each player) that score for the dealer. |
| Starter | The card cut from the deck after the discard. Also called the cut. |
| Count | The running total of card values during the play. Never above 31. |
| Go | What a player says when they cannot play without passing 31. |
| Pegging | Scoring points on the board; also the name for the play stage. |

Two words are used in two senses, the way players use them. **Count** is both
the running total and one sequence of play from 0 up to at most 31 ("the count
ends", "a new count"). **Hand** is both one deal of the game and the four cards
a player holds.

## 2. Card order and values

- **Order (for runs and for cutting):** A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K.
  The ace is **always low**. Q-K-A is not a run.
- **Value (for the count and for fifteens):** ace = 1, cards 2–10 = their
  number, jack, queen and king = 10.
- **Pairs go by rank, not value.** A king and a queen are both worth 10 but are
  not a pair.
- Suits matter only for flushes and for "his nobs" (section 6).

## 3. Deal and discard

1. **First dealer of the first game:** each player cuts a card; the **lower**
   card deals (ace is lowest). Equal ranks cut again. (For a following game see
   section 8.)
2. Every hand starts from the **full 52-card deck, freshly shuffled**. The
   dealer deals **6 cards** to each player, one at a time, starting with the
   pone.
3. Each player chooses **2 cards** and places them face down. These four cards
   are the **crib**. It belongs to the dealer and is not looked at or used until
   the show.
4. Each player now holds **4 cards**.
5. **The deal alternates** every hand for the rest of the game.

## 4. The starter

1. After both players have discarded, the pone cuts the remaining deck (the 40
   cards that were not dealt) and the dealer turns up the top card of the lower
   part. This is the **starter**. It stays face up on the deck.
2. The starter is **not played** during the play. In the show it counts as a
   fifth card for both hands and for the crib.
3. **His heels:** if the starter is a **jack**, the dealer scores **2 points**
   immediately.

## 5. The play (pegging)

### How it goes

1. The **pone leads**: plays one card face up and says its value.
2. Players then **alternate**, each playing one card and announcing the new
   running **count** (the sum of the values of all cards played in this count).
3. Each player keeps their played cards in front of themselves; hands are not
   mixed, because they are counted again in the show.
4. The count may **never exceed 31**. A card that would take it past 31 cannot
   be played.
5. **A player who can play must play.** A player who holds cards but cannot play
   any of them without passing 31 says **"Go"**.
6. After a go, the **other player must keep playing** cards, one after another,
   for as long as they can without passing 31. They score for anything those
   cards make. If they cannot play either, they do **not** say "Go" as well:
   only the first player to be stuck calls it.
7. When neither player can play, the count ends. **Every count ends with exactly
   one award, to the player who played its last card:**
   - **2** if the count is exactly **31**;
   - otherwise **1**. This point is called "go", or "last card" when it is the
     final card of the hand. It is one point under two names and is never
     awarded twice for the same count.
8. The count **resets to 0**. Cards already played stay out of play. The player
   who did **not** play the last card leads the new count. If that player has no
   cards left, the other player leads.
9. A player with **no cards left** simply stops; the other player continues
   playing their remaining cards, still resetting at 31 or when they cannot
   play.
10. The play ends when **all eight cards** have been played. The final count
    ends like any other (step 7): the player of the very last card scores **1
    for last card**, or 2 if it makes 31.

### Points scored during the play

A card scores for whatever it completes at the moment it is played. One card can
score in several ways at once.

| What | Points | Rule |
|---|---|---|
| Fifteen | 2 | The card brings the count to exactly 15. |
| Thirty-one | 2 | The card brings the count to exactly 31. |
| Pair | 2 | Same rank as the card played just before it. |
| Pair royal (three of a kind) | 6 | Third card of the same rank in a row. |
| Double pair royal (four of a kind) | 12 | Fourth card of the same rank in a row. |
| Run | 1 per card | The last 3 or more cards played, taken in any order, form an unbroken sequence of ranks. Score the longest such run. |
| Go / last card | 1 | Played the last card of a count that ended below 31 (step 7). Once per count. |

Details that matter:

- **Pair, pair royal and double pair royal are alternatives.** A card scores
  only the largest that applies: 2, 6 or 12 in total, never 2 + 6.
- **Thirty-one replaces the go or last-card point; it is not added to it.** A
  count that ends on 31 earns 2 where it would otherwise have earned 1, never 3.
  Pairs and runs made by the same card still score on top:
  - 9, 8, 7, 7 → the second 7 scores **4** (pair + thirty-one).
  - K, 6, 7, 8 → the 8 scores **5** (run of three + thirty-one).
- **The go / last-card point adds to anything else the card made.** A last card
  that also makes fifteen scores 2 + 1 = 3.
- **Runs do not need to be played in order.** 3, 5, 4 is a run of three for the
  player of the 4.
- **A run uses only the most recent cards, with nothing in between.** Test every
  length from 3 up to the number of cards played in the current count, and score
  the **longest** length whose cards form a sequence with no repeated rank. Do
  not stop at the first length that fails, or at the first that succeeds.
  - 5, 6, 8, 7 → the 7 scores a run of **4**.
  - 4, 2, 6, 5, 3 → the 5 scores nothing; the 3 scores a run of **5** (the last
    3 and the last 4 cards are not runs, but the last 5 are).
  - 2, 3, A, 4, 5, 6 → the 6 scores a run of **6** (the last 3 cards are a run,
    but so are all 6).
  - 4, 5, 9, 6 → the 6 scores nothing (the 9 is in the way).
  - 6, 7, 7, 8 → the 8 scores nothing (the repeated 7 breaks the run).
- **Pairs must be consecutive.** 7, 8, 7 is not a pair.
- **Nothing carries across a reset.** Pairs and runs only use cards played since
  the count last went back to 0.
- **A "Go" is not a card.** It does not interrupt a pair or a run; only a reset
  does.
- **Your own cards count.** If you play several cards in a row (after a go, or
  because the opponent is out of cards) you can score pairs and runs with them.
- **Flushes do not score during the play.**
- The starter takes no part in the play.

### Worked example of the play

Pone holds 7♠ 8♦ K♥ 3♣. Dealer holds 8♣ 9♥ Q♦ 2♠.

| Step | Player | Plays | Count | Score | Why |
|---|---|---|---|---|---|
| 1 | Pone | 7♠ | 7 | – | |
| 2 | Dealer | 8♣ | 15 | Dealer 2 | Fifteen |
| 3 | Pone | 8♦ | 23 | Pone 2 | Pair |
| 4 | Dealer | 2♠ | 25 | – | 9♥ and Q♦ would pass 31, so the 2 must be played |
| 5 | Pone | 3♣ | 28 | – | K♥ would pass 31, so the 3 must be played. 8, 2, 3 is not a run |
| 6 | Dealer | "Go" | 28 | – | Neither 9♥ nor Q♦ fits |
| 7 | Pone | cannot play either | 28 | Pone 1 | The go point: the pone played the last card of this count. The pone does not say "Go" too |
| | | | **0** | | Count resets. The dealer did not play the last card, so the dealer leads |
| 8 | Dealer | 9♥ | 9 | – | |
| 9 | Pone | K♥ | 19 | – | Pone is now out of cards |
| 10 | Dealer | Q♦ | 29 | Dealer 1 | Last card: the one point for ending the final count. K then Q is not a pair |

Play totals: dealer 3, pone 3.

A shorter example showing a run and thirty-one:
4♥ (4), 5♠ (9), 6♦ (15) → **5** for fifteen (2) plus a run of three (3);
6♥ (21) → **2** for a pair; J♠ (31) → **2** for thirty-one.

## 6. The show (counting)

After the play each player picks their four cards back up. Hands are counted
**in this order**, each together with the starter as a fifth card:

1. The **pone's hand**
2. The **dealer's hand**
3. The **crib** (scored by the dealer)

The order matters near the end of a game: the pone can reach 121 and win before
the dealer gets to count.

### Points scored in the show

Every distinct combination of cards scores separately, and a card may be used in
any number of combinations.

| What | Points | Rule |
|---|---|---|
| Fifteen | 2 each | Every different set of two or more cards whose values add up to 15. |
| Pair | 2 each | Every different pair of cards of the same rank. Three of a kind is three pairs (6); four of a kind is six pairs (12). |
| Run | 1 per card | Every different set of three or more cards in sequence. Only the longest runs count: A-2-3-4 is one run of four (4), not two runs of three. |
| Flush (hand) | 4 or 5 | All four cards **in the hand** are the same suit: 4. If the starter is that suit too: 5. |
| Flush (crib) | 5 | The crib scores a flush only if all four crib cards **and** the starter are the same suit. A four-card flush in the crib scores nothing. |
| His nobs | 1 | A jack in the hand (or crib) of the same suit as the starter. |

Details that matter:

- **Flush needs the four hand cards.** Three hand cards plus the starter in one
  suit is not a flush.
- **Nobs is for a jack you hold**, never for the starter itself. (A jack starter
  already scored 2 for the dealer as his heels.)
- **Duplicate cards multiply runs.** Each different way of picking the cards is
  a separate run:

  | Pattern | Example | Run points | Pair points | Total (before fifteens) |
  |---|---|---|---|---|
  | Double run of three | 3-4-4-5 | 2 × 3 = 6 | 2 | 8 |
  | Double run of four | 3-4-5-5-6 | 2 × 4 = 8 | 2 | 10 |
  | Triple run | 3-4-4-4-5 | 3 × 3 = 9 | 6 | 15 |
  | Double double run | 3-3-4-4-5 | 4 × 3 = 12 | 4 | 16 |

- Hands are traditionally counted aloud in the order fifteens, pairs, runs,
  flush, nobs: "fifteen two, fifteen four, and a pair is six".
- The highest possible hand is **29**: three 5s and a jack in the hand, with the
  fourth 5 as the starter in the jack's suit (eight fifteens = 16, six pairs =
  12, nobs = 1).
- No hand can score **19, 25, 26 or 27**.

### Worked example of the show

Continuing the example above, with starter **5♥**.

- **Pone's hand** 7♠ 8♦ K♥ 3♣ + 5♥ → **6**
  - fifteens: 7+8, K+5, 7+3+5 → 6
- **Dealer's hand** 8♣ 9♥ Q♦ 2♠ + 5♥ → **4**
  - fifteens: Q+5, 8+5+2 → 4
  - 8-9 is only two cards, and the queen is not next to the 9, so there is no run
- **Crib** 4♦ 6♠ J♥ A♣ + 5♥ → **10** (for the dealer)
  - fifteens: J+5, 4+5+6, J+4+A → 6
  - run: 4-5-6 → 3
  - his nobs: J♥ matches the 5♥ starter → 1

Hand totals: pone 3 + 6 = 9; dealer 3 + 4 + 10 = 17.

More hands to check an implementation against:

| Hand | Starter | Crib? | Score | Breakdown |
|---|---|---|---|---|
| 5♥ 5♦ 5♠ J♣ | 5♣ | no | 29 | 8 fifteens (16), 6 pairs (12), nobs (1) |
| 5♣ 5♦ 5♥ 5♠ | K♦ | no | 28 | 8 fifteens (16), 6 pairs (12) |
| 7♥ 7♦ 8♠ 8♣ | 9♦ | no | 24 | 4 fifteens (8), 2 pairs (4), 4 runs of three (12) |
| 3♥ 3♦ 4♠ 4♣ | 5♦ | no | 20 | 2 fifteens (4), 2 pairs (4), 4 runs of three (12) |
| 3♥ 3♦ 3♠ 4♣ | 5♦ | no | 21 | 3 fifteens (6), 3 pairs (6), 3 runs of three (9) |
| 2♥ 6♥ 9♥ K♥ | 3♠ | no | 8 | 2 fifteens (4), four-card flush (4) |
| 2♥ 6♥ 9♥ K♥ | 3♠ | yes | 4 | 2 fifteens (4); four-card flush does not count in the crib |
| 2♥ 6♥ 9♥ K♥ | 3♥ | yes | 9 | 2 fifteens (4), five-card flush (5) |
| 2♣ 4♦ 6♥ 8♠ | K♣ | no | 0 | nothing |

## 7. Next hand

After the crib is counted the cards are gathered, the **deal passes to the other
player**, and a new hand begins at section 3. This repeats until someone wins.

## 8. Winning

- The first player to reach **121** wins.
- The game ends **the instant** a player reaches 121, at any stage: on his
  heels, on any point during the play, or part-way through the show. Nothing
  after that is scored. If the pone counts out in the show, the dealer's hand
  and crib are never counted.
- There is no need to hit 121 exactly; extra points are ignored and the score is
  recorded as 121.
- **Skunk:** the loser finished on **61 to 90** points (did not reach 91).
- **Double skunk:** the loser finished on **60 or fewer** points (did not reach
  61).
- A game is reported as exactly one of: normal win, skunk, double skunk. The
  loser's score is taken at the instant the game ends; points in a hand or crib
  that was never counted do not rescue a skunk.
- A skunk or double skunk does not change who won. Where a series of games is
  being scored, a skunk traditionally counts as two games and a double skunk as
  three or four depending on house rule; this project only reports them.
- If the same two players play again, the **loser of the previous game deals
  first** (the usual convention; there is no new cut).

## 9. The board and pegs

- Each player has a track of 120 holes plus a shared or final **game hole**
  (121), and **two pegs**.
- Pegs leapfrog: to score, move the **rear** peg ahead of the front peg by the
  number of points just scored. The front peg always shows the current score and
  the rear peg the score before the last points were added.
- Both pegs start off the track (score 0).
- Boards mark the skunk line between holes 90 and 91, and some also mark a
  double-skunk line between 60 and 61.

## 10. Checklist of easily missed rules

1. Ace is low only; K-A-2 and Q-K-A are not runs.
2. 10, J, Q and K all count 10 but only pair with their own rank.
3. Jack starter: dealer scores 2 at once, and this can win the game.
4. The pone leads the first count of every hand.
5. A player who can play must play; "go" is only for a player holding cards
   with no legal play. A player with no cards says nothing.
6. Only the first player to be stuck says "go". The other player must then keep
   playing while able, possibly several cards in a row, and never says "go"
   back.
7. Each count ends with exactly one award to the player of its last card: 2 for
   thirty-one, otherwise 1 (go, or last card at the end of the hand). Never
   both, never 3.
8. That end-of-count point is added to any fifteen, pair or run made by the
   same card. A card that makes 31 can also score a pair or a run.
9. Pair, pair royal and double pair royal are alternatives (2, 6 or 12), not
   cumulative.
10. Pairs and runs in the play never span a count reset; a "go" on its own does
    not break them.
11. In the play, runs are found in the most recent cards only; a repeated rank
    or an unrelated card in between breaks the run. Check every length and take
    the longest.
12. After a reset, the player who did not play the last card leads, if they
    still have cards.
13. Flushes never score in the play.
14. A hand flush is the four hand cards (4), plus the starter for 5. A crib
    flush needs all five.
15. Nobs is a jack held in hand or crib matching the starter's suit; a jack
    starter is heels, not nobs.
16. The show is counted pone, then dealer, then crib; check for a winner after
    every single award.
17. The crib always belongs to the dealer, and the deal alternates every hand.
18. Skunk (loser on 61–90) and double skunk (loser on 60 or fewer) are separate
    outcomes; report one, using the loser's score when the game ended.

## 11. What this project leaves out

These exist in cribbage but are **not** part of this implementation:

- **Muggins** (claiming points an opponent failed to count). Scoring here is
  automatic, so nothing can be missed.
- **Manual counting and pegging errors, misdeals and penalties.**
- **Other forms of the game:** five-card and seven-card cribbage, three- and
  four-player games, games to 61, lowball.
