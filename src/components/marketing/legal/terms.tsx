import type { LegalDoc } from "../legal-document";
import { SUPPORT_EMAIL } from "../marketing-ui";

/*
 * Terms of service. Draft written to match how Crystal works today (see the
 * notes beside each section). Have it reviewed by a lawyer before launch.
 * Facts used: 13+ minimum age, Stripe payments in USD/AUD/EUR/GBP, cancel-at-
 * period-end subscriptions, full refunds by staff, 80% default creator share
 * via Stripe Connect, self-hosted bots, staff review of shop items, bots and
 * extensions, platform enforcement in convex/operations.ts.
 */

const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of service",
  updated: "15 October 2026",
  summary: (
    <>
      These terms are the agreement between you and Poliberry, the people who run Crystal. In short: be at least 13, follow the <a href="/legal/guidelines/">community guidelines</a>, you own what you post, and Crystal is in beta, so things will change. The sections below have the detail.
    </>
  ),
  sections: [
    {
      id: "about",
      title: "About these terms",
      body: (
        <>
          <p>
            Crystal (the apps, the website at usecrystal.app, Crystal Studio, the Bot API and the SDKs) is operated by <b>Poliberry</b>, based in Australia (“we”, “us”). By creating an account, using Crystal as a guest, or using our APIs, you agree to these terms, our <a href="/legal/guidelines/">community guidelines</a> and our <a href="/legal/privacy-policy/">privacy policy</a>.
          </p>
          <p>If you’re using Crystal on behalf of an organisation, you’re agreeing on its behalf and confirming you’re allowed to.</p>
        </>
      ),
    },
    {
      id: "eligibility",
      title: "Who can use Crystal",
      body: (
        <>
          <p>
            You must be at least <b>13 years old</b>. If the law where you live requires you to be older to agree to these terms or to the use of your data without a parent’s consent (in some EU countries that age is up to 16), you must be that age or have your parent or guardian’s permission. If you’re under 18, a parent or guardian should read these terms with you.
          </p>
          <p>You can’t use Crystal if we’ve previously banned you, or if you’re barred from receiving our services under the laws that apply to you.</p>
        </>
      ),
    },
    {
      id: "account",
      title: "Your account",
      body: (
        <>
          <ul>
            <li>Give us a real email address you control, and keep your password and recovery key safe. You’re responsible for what happens on your account.</li>
            <li>Turn on two-factor authentication if you can. Tell us straight away at {mail} if you think someone else has got into your account.</li>
            <li>Your encryption recovery key is only shown to you. We can’t see it or recover it, so if you lose it and have no signed-in device left, older encrypted messages stay unreadable.</li>
            <li>Guest accounts last 24 hours, can’t upload files, create communities or send friend requests, and are wiped when they expire.</li>
            <li>Usernames aren’t property. We may reclaim a username that impersonates someone, infringes a trademark, or has been inactive for a long time.</li>
          </ul>
        </>
      ),
    },
    {
      id: "content",
      title: "Your content",
      body: (
        <>
          <p>You own what you post on Crystal: messages, images, profiles, communities, cosmetics and code.</p>
          <p>
            So that we can run Crystal, you give us a worldwide, non-exclusive, royalty-free licence to host, store, copy, transmit, display and adapt your content (for example, resizing an image) only as needed to operate, secure and improve Crystal and to show it to the people you’ve shared it with. This licence ends when you delete the content, except where it has been shared with others who still have it, where we must keep it by law, or where it’s held as evidence for a report.
          </p>
          <p>End-to-end encrypted message text can’t be read by us, so this licence covers handling it in encrypted form.</p>
          <p>You confirm you have the rights to what you post and that it follows our guidelines. We don’t check content before it’s posted (except shop items, public bots and extensions), but we may remove anything that breaks these terms or the law.</p>
        </>
      ),
    },
    {
      id: "rules",
      title: "Rules",
      body: (
        <>
          <p>Follow the <a href="/legal/guidelines/">community guidelines</a>. In addition, don’t:</p>
          <ul>
            <li>break the law, or use Crystal to help anyone else break it;</li>
            <li>access Crystal by any means other than our apps and published APIs, or scrape, crawl or automate a normal user account;</li>
            <li>try to get around permissions, rate limits, encryption, bans or other safety features;</li>
            <li>interfere with, overload or probe the security of Crystal, except through responsible disclosure to {mail};</li>
            <li>sell, rent or transfer your account.</li>
          </ul>
        </>
      ),
    },
    {
      id: "purchases",
      title: "Purchases, subscriptions and refunds",
      body: (
        <>
          <p>
            You can buy cosmetics, community items, bundles and subscriptions (such as Crystal Geode). Prices are shown before you pay, in USD, AUD, EUR or GBP, and include any tax we’re required to charge. Payments are handled by Stripe; we never see your card details.
          </p>
          <h3>Digital items</h3>
          <p>
            When you buy an item, you get a personal, non-transferable licence to use it on Crystal. Items have no cash value and can’t be exchanged, resold or moved to another account. We may revoke an item bought in breach of these terms or by fraud, or remove an item that infringes someone’s rights; if we remove an item for a reason that isn’t your fault, we’ll offer a refund or a replacement.
          </p>
          <h3>Subscriptions</h3>
          <p>
            Subscriptions renew automatically each month or year until you cancel. You can cancel at any time in Settings. Your subscription keeps working until the end of the period you’ve paid for and then stops; you won’t be charged again. We’ll tell you in advance if a price changes, and you can cancel before it applies.
          </p>
          <h3>Refunds</h3>
          <p>
            If something you bought didn’t work as described, or you were charged by mistake, email {mail} and we’ll sort it out. Refunds are made in full to your original payment method, and the item or subscription is removed. Nothing in these terms limits your rights under the Australian Consumer Law or other consumer laws that apply to you, including any right to a refund for a major failure.
          </p>
        </>
      ),
    },
    {
      id: "creators",
      title: "Selling in the shop",
      body: (
        <>
          <p>If you sell items you’ve made in Crystal Studio:</p>
          <ul>
            <li>You must own the item or have the rights to sell it, and it must follow our guidelines. We review every submission and update, and may reject, remove or stop selling an item at our discretion.</li>
            <li>You keep <b>80%</b> of each sale’s price, unless a different share is agreed when your item is approved. Payment processing fees come out of our share.</li>
            <li>Payouts are made through Stripe Connect, and you must accept Stripe’s terms and complete its checks. Earnings from sales made before your payout account is ready are held and paid once it is.</li>
            <li>If a sale is refunded, your share of it is reversed.</li>
            <li>You’re responsible for any taxes on your earnings.</li>
            <li>You give buyers the licence described in “Digital items” above, and give us the right to display, promote and distribute your item on Crystal.</li>
          </ul>
        </>
      ),
    },
    {
      id: "developers",
      title: "Bots, extensions and the API",
      body: (
        <>
          <ul>
            <li>You host and run your own bots. You’re responsible for them, including keeping their tokens secret and keeping them within the permissions communities grant.</li>
            <li>Use only the data your bot or extension is given, for the purpose people added it for. Don’t store more than you need, don’t sell or share it, and delete it when asked or when you stop operating.</li>
            <li>Respect the rate limits. We may change, limit or stop API access, and suspend any bot or extension, at any time, especially to protect people.</li>
            <li>Public bots and every extension version are reviewed before others can add them. Review doesn’t make us responsible for third-party bots and extensions; their developers are.</li>
          </ul>
        </>
      ),
    },
    {
      id: "third-party",
      title: "Other services",
      body: (
        <p>
          Crystal links to and works with other services (for example Twitch, YouTube, TikTok, Spotify, GIF providers, and bots and extensions made by others). We don’t control them and aren’t responsible for them. Their own terms and privacy policies apply when you use them.
        </p>
      ),
    },
    {
      id: "beta",
      title: "Crystal is in beta",
      body: (
        <p>
          Crystal is still being built. Features may change, appear or disappear, and things will sometimes break. We’ll try to give notice of big changes, but we don’t promise that any particular feature will keep working the same way. Keep your own copies of anything important.
        </p>
      ),
    },
    {
      id: "enforcement",
      title: "Suspension and ending your account",
      body: (
        <>
          <p>
            If you break these terms or the guidelines, or we need to in order to protect people or comply with the law, we may remove content, limit, suspend or ban your account, or restrict a community, as described in the <a href="/legal/guidelines/#enforcement">guidelines</a>. Where it’s safe and lawful, we’ll tell you why and how to ask us to review the decision.
          </p>
          <p>You can stop using Crystal at any time, and delete your account yourself in <b>Settings → Privacy Center</b>. Deleting it cancels any subscriptions straight away, without a refund for the rest of the period unless the law requires one. What happens to your data is explained in our <a href="/legal/privacy-policy/#retention">privacy policy</a>.</p>
          <p>If your account ends, the licences you’ve given us end as described in “Your content”, and your licences to purchased items end. Sections that by their nature should survive (such as liability and disputes) continue to apply.</p>
        </>
      ),
    },
    {
      id: "liability",
      title: "Warranties and liability",
      body: (
        <>
          <p>
            Some laws, including the Australian Consumer Law and consumer laws in the EU and UK, give you guarantees and rights that can’t be excluded. Nothing in these terms takes those away.
          </p>
          <p>
            Apart from those rights, Crystal is provided “as is” and “as available”, and to the extent the law allows we don’t make other promises about it, including that it will be uninterrupted, error-free or suitable for a particular purpose.
          </p>
          <p>
            To the extent the law allows, we aren’t liable for indirect or consequential loss, lost profits or lost data, or for content or conduct of other users, bots or extensions. Where our liability for a failure to meet a consumer guarantee can be limited, it’s limited to supplying the service again or paying the cost of doing so. Otherwise, our total liability to you is limited to the greater of the amount you paid us in the 12 months before the claim and AUD 100.
          </p>
          <p>If you use Crystal for business, you agree to cover our reasonable losses arising from your breach of these terms or the law.</p>
        </>
      ),
    },
    {
      id: "disputes",
      title: "Governing law and disputes",
      body: (
        <>
          <p>
            These terms are governed by the laws of Australia. If something goes wrong, please contact us first at {mail}; most problems can be fixed quickly.
          </p>
          <p>
            If you live in the European Union, the United Kingdom or the United States, you keep the protection of the mandatory laws of the place you live, and you may bring a claim in your local courts where those laws allow. Otherwise, disputes go to the courts of Australia.
          </p>
        </>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: (
        <p>
          We may update these terms as Crystal changes. If a change is significant, we’ll tell you in the app or by email before it takes effect. If you keep using Crystal after that, the new terms apply; if you don’t agree, you can stop using Crystal and close your account.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: <p>Questions about these terms? Email {mail}.</p>,
    },
  ],
};
