import type { LegalDoc } from "../legal-document";
import { SUPPORT_EMAIL } from "../marketing-ui";

/*
 * Privacy policy. The plain-English companion is /privacy (privacy-page.tsx),
 * which holds the detailed data, vendor and retention tables; the two must
 * agree. Draft written against the code as of the date below. Have it reviewed
 * by a lawyer before launch, in particular the transfer safeguards and the
 * EU/UK representative question.
 */

const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

export const PRIVACY_POLICY: LegalDoc = {
  slug: "privacy-policy",
  title: "Privacy policy",
  updated: "15 October 2026",
  summary: (
    <>
      This policy explains how Poliberry collects, uses and shares personal information when you use Crystal, and the rights you have over it. For a plain-English walkthrough with the full list of providers and what each one receives, see <a href="/privacy/">How we handle your data</a>.
    </>
  ),
  sections: [
    {
      id: "who",
      title: "Who we are",
      body: (
        <>
          <p>
            Crystal is operated by <b>Poliberry</b>, based in Australia. Poliberry is responsible for your personal information under this policy: the “data controller” under the EU and UK GDPR, and an “APP entity” under the Australian Privacy Act 1988.
          </p>
          <p>Contact us about privacy at {mail}.</p>
        </>
      ),
    },
    {
      id: "collect",
      title: "Information we collect",
      body: (
        <>
          <h3>Information you give us</h3>
          <ul>
            <li><b>Account details:</b> email address, password (stored only as a salted hash), username and display name.</li>
            <li><b>Profile details:</b> avatar, banner, bio, statuses, cosmetics and, if you choose to add it, your date of birth.</li>
            <li><b>Content:</b> messages, attachments, reactions, communities you create, reports you file, support requests, and items, bots and extensions you make.</li>
            <li><b>Security details:</b> two-factor secrets (encrypted), backup codes (hashed) and passkeys (public keys only).</li>
            <li><b>Purchase details:</b> what you bought and when. Stripe collects your payment details; we don’t receive your card number.</li>
            <li><b>Creator details:</b> if you link Twitch, YouTube or TikTok, your channel details and membership information. If you sell items, your payout status from Stripe.</li>
          </ul>
          <h3>Information collected automatically</h3>
          <ul>
            <li><b>Network addresses:</b> IP addresses, stored as a keyed hash and an encrypted copy, and limited to the 25 most recent per account.</li>
            <li><b>Presence and activity:</b> whether you’re online and, if you leave “Share my activity” on in the desktop app, the game you’re playing or the song you’re listening to. Game detection happens on your device.</li>
            <li><b>Game history:</b> games you’ve played and total time played. Music isn’t recorded.</li>
            <li><b>Session data:</b> sign-in sessions and the tokens that keep you signed in.</li>
          </ul>
          <h3>Information from others</h3>
          <ul>
            <li>Other people may mention you, add you as a friend, include your messages in a report, or add you to a community or group.</li>
            <li>Twitch, YouTube or TikTok, if you link an account, tell us whether you’re a member or subscriber of a channel.</li>
            <li>Stripe tells us whether a payment succeeded or was refunded.</li>
          </ul>
        </>
      ),
    },
    {
      id: "e2ee",
      title: "End-to-end encrypted messages",
      body: (
        <p>
          The text of direct messages and community messages is end-to-end encrypted: it is encrypted on the sender’s device with keys we don’t have, so we can’t read it. We can see information around a message, such as who sent it, when, where, its attachments and reactions. Some content isn’t end-to-end encrypted, including attachments, forum and AMA posts, lounge chat and support tickets. <a href="/privacy/#encryption">See the full list.</a> When you report a message, the content you include in the report is shared with our team.
        </p>
      ),
    },
    {
      id: "use",
      title: "How we use information, and our legal bases",
      body: (
        <>
          <p>We use personal information only for these purposes. Where the EU or UK GDPR applies, we rely on the legal basis shown.</p>
          <ul>
            <li><b>To provide Crystal:</b> creating your account, delivering messages and calls, showing your profile, running communities, processing purchases and paying creators. <i>Basis: performing our contract with you.</i></li>
            <li><b>To keep Crystal safe:</b> preventing spam, fraud and abuse, enforcing our terms and guidelines, reviewing reports, and securing accounts. <i>Basis: our legitimate interest in a safe service, and our contract with you.</i></li>
            <li><b>Sharing your activity:</b> showing friends the game or music you’re playing in the desktop app. This is on by default and you can turn it off at any time with “Share my activity”. <i>Basis: our legitimate interest in the social features you signed up for, balanced by your ability to opt out.</i></li>
            <li><b>Optional features:</b> birthday features from your date of birth, and linking creator accounts. <i>Basis: your consent, which you can withdraw by removing the information or disconnecting the account.</i></li>
            <li><b>To communicate with you:</b> sign-in codes, security alerts, receipts, important changes and replies to support requests. <i>Basis: our contract with you, and our legitimate interests.</i></li>
            <li><b>To improve Crystal:</b> fixing bugs and understanding which features are used, from information we already hold. We don’t use third-party analytics or advertising trackers. <i>Basis: our legitimate interests.</i></li>
            <li><b>To meet legal obligations:</b> tax and accounting records, and responding to lawful requests. <i>Basis: legal obligation.</i></li>
          </ul>
          <p>We don’t sell personal information, we don’t use it for advertising, and we don’t use your messages to train AI models. We don’t make decisions about you based solely on automated processing that have legal or similarly significant effects.</p>
        </>
      ),
    },
    {
      id: "share",
      title: "Who we share information with",
      body: (
        <>
          <ul>
            <li><b>Other people on Crystal:</b> what you post and your profile are visible to the people and communities you share them with.</li>
            <li><b>Service providers</b> who run parts of Crystal for us under contract and only on our instructions, including Convex (database and backend), Cloudflare (hosting and file storage), LiveKit (voice and video), Stripe (payments and payouts), Resend (email) and, for mobile push notifications, Expo, Apple and Google. <a href="/privacy/#vendors">The full list, and what each receives.</a></li>
            <li><b>Services you connect:</b> bots, extensions, game-server panels, Twitch, YouTube and TikTok receive the information you or your community allow them to, under their own privacy policies.</li>
            <li><b>Legal and safety:</b> law enforcement, regulators or others where we’re required to by law, or where we believe in good faith it’s necessary to protect someone’s safety, investigate fraud or abuse, or defend our rights. We report child sexual exploitation material to the relevant authorities.</li>
            <li><b>Business changes:</b> if Poliberry is involved in a merger, acquisition or sale of assets, information may transfer as part of it, and this policy will continue to apply to it.</li>
          </ul>
        </>
      ),
    },
    {
      id: "transfers",
      title: "International transfers",
      body: (
        <p>
          Crystal is run from Australia. Your information is stored in the United States: our database is in Northern Virginia, and our payment, email and GIF providers store data in US East. It may also be processed in Australia and in other countries where our providers operate. Where the law requires it, for example for transfers out of the EU or UK, we use appropriate safeguards such as standard contractual clauses. Contact us for more information.
        </p>
      ),
    },
    {
      id: "retention",
      title: "How long we keep information",
      body: (
        <>
          <p>We keep personal information only for as long as we need it for the purposes above:</p>
          <ul>
            <li>Account and profile information: while your account exists.</li>
            <li>Messages: until you or a moderator deletes them, or your account is deleted. A message’s files are deleted with it, unless the same file is still used elsewhere or is held as evidence in a report.</li>
            <li>Guest accounts: 24 hours, after which the profile, friends and memberships are wiped. Messages a guest sent remain, attributed to “Expired guest”.</li>
            <li>IP addresses: the 25 most recent per account. Records needed to enforce a ban are kept while the ban applies.</li>
            <li>Sign-in codes, tickets and rate-limit records: hours to a few days.</li>
            <li>Purchase records: as long as tax and accounting laws require.</li>
            <li>Reports and moderation records: as long as needed to handle the report, prevent repeat abuse and meet legal obligations.</li>
          </ul>
          <p>
            When you delete your account, we immediately sign you out everywhere, remove your email address, password and security keys, and wipe your profile and its pictures. We then delete the messages you wrote and their files, your memberships, friends, saved messages, notifications, presence and game history, linked accounts, encryption keys, IP records and bots, usually within minutes. We keep purchase records (for tax and accounting), reports and moderation records (for safety), and reactions, forum and AMA posts and lounge chat, all shown as “Deleted user”. You can ask us to remove the last group too.
          </p>
        </>
      ),
    },
    {
      id: "security",
      title: "Security",
      body: (
        <p>
          We protect information with end-to-end encryption for message text, encryption in transit, encryption of sensitive secrets at rest, salted password hashing, two-factor authentication and passkeys, rate limits and access controls. No system is perfectly secure; if a breach affects your information, we’ll notify you and the relevant regulators as the law requires. Please report security issues to {mail}.
        </p>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <p>You can ask us to:</p>
          <ul>
            <li>give you access to, or a copy of, your personal information;</li>
            <li>correct information that’s wrong;</li>
            <li>delete your account and personal information;</li>
            <li>restrict or object to how we use it, including where we rely on legitimate interests;</li>
            <li>transfer it to you or another service in a portable format.</li>
          </ul>
          <p>
            You can download a copy of your data and delete your account yourself, in <b>Settings → Privacy Center</b>. For anything else, email {mail} from the address on your account. We may need to confirm it’s you, and we’ll reply within 30 days. You won’t be treated differently for using these rights.
          </p>
          <h3>Australia</h3>
          <p>If you’re not happy with how we handle a privacy complaint, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).</p>
          <h3>European Union and United Kingdom</h3>
          <p>You also have the right to withdraw consent at any time, and to complain to your local data protection authority or, in the UK, the Information Commissioner’s Office.</p>
          <h3>United States</h3>
          <p>Depending on your state (for example California), you have the right to know what we collect, to access, correct and delete it, and to opt out of its sale or sharing for targeted advertising. We don’t sell or share personal information for advertising. You can use an authorised agent to make a request.</p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          Crystal isn’t for children under 13, and we don’t knowingly collect information from them. Where the law sets a higher age for consenting to data processing, users under that age need a parent or guardian’s consent. If you believe a child under 13 is using Crystal, contact {mail} and we’ll delete the account.
        </p>
      ),
    },
    {
      id: "storage",
      title: "Cookies and local storage",
      body: (
        <p>
          We don’t use advertising or analytics cookies. Crystal stores what it needs to work on your device, such as your sign-in session, settings and, for end-to-end encryption, your keys. The desktop app keeps your keys in your operating system’s secure storage. Our site loads a colour emoji font from Google Fonts, which means Google receives your IP address when the font loads.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: <p>We’ll update this policy as Crystal changes. If a change is significant, we’ll tell you in the app or by email before it takes effect. The date at the top shows when it was last updated.</p>,
    },
    {
      id: "contact",
      title: "Contact",
      body: <p>For privacy questions or requests, email {mail}.</p>,
    },
  ],
};
