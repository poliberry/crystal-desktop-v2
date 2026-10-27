import type { LegalDoc } from "../legal-document";
import { SUPPORT_EMAIL } from "../marketing-ui";

/*
 * Community guidelines. The report categories in "Reporting" match
 * convex/reports.ts; the enforcement options match convex/operations.ts and
 * the community moderation tools. Keep them in step.
 */

export const GUIDELINES: LegalDoc = {
  slug: "guidelines",
  title: "Community guidelines",
  updated: "15 October 2026",
  summary: (
    <>
      Crystal is for hanging out with your people. These rules apply everywhere on Crystal: DMs, communities, profiles, bots, extensions and anything sold in the shop. Communities can add their own rules on top, but they can’t loosen these.
    </>
  ),
  sections: [
    {
      id: "respect",
      title: "Be decent to each other",
      body: (
        <>
          <p>Disagree, joke around and trash-talk your friends at game night. Just don’t make Crystal worse for someone else.</p>
          <ul>
            <li><b>No harassment or bullying.</b> That includes targeted insults, piling on, unwanted contact after someone has asked you to stop, and encouraging others to do any of it.</li>
            <li><b>No hate.</b> Don’t attack or demean people for their race, ethnicity, national origin, religion, caste, sexual orientation, sex, gender identity, disability, serious illness or age.</li>
            <li><b>No threats.</b> Not even as a joke when the other person can’t tell it’s one.</li>
          </ul>
        </>
      ),
    },
    {
      id: "safety",
      title: "Keep people safe",
      body: (
        <>
          <ul>
            <li><b>No violent extremism.</b> Don’t promote, support or organise violent extremist groups or acts, or share their propaganda.</li>
            <li><b>No glorifying violence or graphic gore.</b></li>
            <li><b>No encouraging self-harm or suicide.</b> If someone is struggling, be kind, and report it so we can share support resources. If someone is in immediate danger, contact local emergency services.</li>
            <li><b>Nothing that sexualises minors. Ever.</b> We report child sexual exploitation material to the authorities and remove the accounts involved.</li>
          </ul>
        </>
      ),
    },
    {
      id: "sfw",
      title: "Keep it safe for work",
      body: (
        <>
          <p>
            Crystal doesn’t have age-restricted spaces yet, and people as young as 13 use it. So sexually explicit content, including pornography, sexual solicitation and sexual roleplay, isn’t allowed anywhere: not in communities, profiles, DMs, stickers or cosmetics.
          </p>
          <p>Never share intimate images of anyone without their consent, including fake or AI-generated ones.</p>
        </>
      ),
    },
    {
      id: "privacy",
      title: "Respect people’s privacy",
      body: (
        <ul>
          <li><b>Don’t share someone’s personal information</b> (address, phone number, real name, workplace, photos) without their permission.</li>
          <li><b>Don’t post private conversations or images</b> to embarrass or expose someone.</li>
          <li><b>Don’t record calls or screen-shares</b> without the consent of the people in them where the law requires it.</li>
        </ul>
      ),
    },
    {
      id: "honest",
      title: "Be honest",
      body: (
        <ul>
          <li><b>No scams or phishing.</b> No fake giveaways, fake “Crystal staff” messages, or links that steal accounts or money.</li>
          <li><b>No impersonation</b> of other people, creators, brands or Crystal staff in a way that misleads.</li>
          <li><b>No spam.</b> That includes mass DMs, unwanted advertising, repeated messages and joining communities just to promote something.</li>
          <li><b>No harmful misinformation</b> that could cause real-world harm, such as false medical advice or interfering with elections.</li>
        </ul>
      ),
    },
    {
      id: "legal",
      title: "Keep it legal",
      body: (
        <ul>
          <li>Don’t use Crystal to buy, sell or promote illegal goods or services, including drugs, weapons and stolen accounts.</li>
          <li>Don’t share malware or help people break into accounts, devices or services.</li>
          <li>Don’t post content you don’t have the rights to, such as pirated games, films or other people’s artwork.</li>
        </ul>
      ),
    },
    {
      id: "platform",
      title: "Play fair with Crystal",
      body: (
        <ul>
          <li><b>Don’t dodge enforcement.</b> Making a new account or community to get around a ban, suspension or limit gets the new one removed too.</li>
          <li><b>Don’t abuse the platform.</b> No exploiting bugs, overwhelming our systems, scraping, or automating a normal user account. If you find a security bug, email us; we’d love to hear about it.</li>
          <li><b>Don’t misuse reports.</b> Reporting people you simply disagree with, or flooding our team with false reports, is itself a violation.</li>
        </ul>
      ),
    },
    {
      id: "builders",
      title: "Bots, extensions, cosmetics and creator communities",
      body: (
        <>
          <p>If you make things for Crystal, these rules apply to what you make as well as to you:</p>
          <ul>
            <li>Bots and extensions must do what they say, ask only for the permissions they need, and handle people’s data responsibly. Don’t collect data people didn’t expect to share, and never sell it.</li>
            <li>Shop items must be your own work (or work you have the rights to) and follow these guidelines. Every item is reviewed before it goes on sale.</li>
            <li>Creator communities must follow these guidelines and the rules of the platform you’ve linked (Twitch, YouTube or TikTok).</li>
          </ul>
        </>
      ),
    },
    {
      id: "owners",
      title: "If you run a community",
      body: (
        <>
          <p>Community owners and moderators set the tone. You’re responsible for making a reasonable effort to keep your space within these guidelines, using the tools Crystal gives you: rules, roles, timeouts, kicks and bans.</p>
          <p>We may act against a community as a whole, not just individual members, if it’s organised around breaking these rules or its moderators let it happen.</p>
        </>
      ),
    },
    {
      id: "reporting",
      title: "Reporting",
      body: (
        <>
          <p>
            Use <b>Report</b> on a person, a message or a community. Choose the closest reason (spam, harassment, hate, sexual content, violence, self-harm, impersonation, scam, or something else) and add any detail that helps.
          </p>
          <p>
            When you report a message, we keep a copy of it and the reported person’s other recent messages in that conversation as evidence, so it’s still there if they delete it. In end-to-end encrypted chats we can only see what’s included in the report.
          </p>
          <p>A member of our team reviews every report. For anything urgent or that doesn’t fit the report button, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        </>
      ),
    },
    {
      id: "enforcement",
      title: "What happens if you break the rules",
      body: (
        <>
          <p>We look at what happened, how serious it was, and whether it’s happened before. Depending on that, we may:</p>
          <ul>
            <li>remove the content;</li>
            <li><b>limit</b> your account, taking away specific things like sending messages, joining communities, uploading or using voice;</li>
            <li><b>suspend</b> your account for a set time or until further notice, so you can read but not take part;</li>
            <li><b>ban</b> your account, which may also stop new accounts being made from the networks you used;</li>
            <li>restrict, archive, suspend or close a community;</li>
            <li>remove a bot, extension or shop item, or revoke purchases made in breach of these rules;</li>
            <li>report illegal content to law enforcement where we’re required to or where someone’s safety is at risk.</li>
          </ul>
          <p>If you think we got it wrong, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the address on your account and ask us to take another look. Tell us what happened and why you think the decision was wrong, and we’ll review it again.</p>
        </>
      ),
    },
  ],
};
