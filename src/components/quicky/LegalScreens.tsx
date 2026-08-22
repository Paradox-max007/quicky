'use client'

import { motion } from 'framer-motion'
import { SettingsSubScreen } from './SettingsSubScreen'
import { FileText, Scale, Heart, Shield, AlertTriangle, RefreshCw } from 'lucide-react'

export function TermsOfServiceScreen() {
  return (
    <SettingsSubScreen title="Terms of Service">
      <div className="px-5 py-5">
        {/* Animated header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center text-center mb-6"
        >
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FF2D55] to-[#FF5E7E] flex items-center justify-center glow-coral mb-3"
          >
            <Scale className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-xs text-white/50 mt-1">Last updated: August 2026 · v1.0</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-[#FF2D55]/10 border border-[#FF2D55]/30 rounded-2xl p-3 mb-4 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-[#FF2D55] shrink-0 mt-0.5" />
          <p className="text-xs text-white/80">
            By using Quicky, you agree to these terms. Please read them carefully — they govern your use of the app.
          </p>
        </motion.div>

        <div className="flex flex-col gap-4">
          <Section icon={<Heart className="w-4 h-4 text-[#FF5E7E]" />} title="1. Acceptance of Terms" delay={0.4}>
            By downloading, installing, or using Quicky (&quot;the Service&quot;), you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, please do not use the Service. Your continued use of the Service constitutes ongoing acceptance of these terms.
          </Section>

          <Section icon={<FileText className="w-4 h-4 text-[#FF5E7E]" />} title="2. Eligibility" delay={0.5}>
            You must be at least 18 years old to use Quicky. By using the Service, you represent and warrant that you are at least 18 years of age, that you have the legal capacity to enter into these terms, and that your use of the Service does not violate any applicable law or regulation. We reserve the right to verify your age and terminate accounts found to be in violation of this requirement.
          </Section>

          <Section icon={<Shield className="w-4 h-4 text-[#FF5E7E]" />} title="3. User Conduct" delay={0.6}>
            You agree to use Quicky respectfully and lawfully. You will not: (a) harass, abuse, threaten, or impersonate others; (b) post false, misleading, or offensive content; (c) use the Service for any commercial purpose without our prior written consent; (d) attempt to disrupt, hack, or reverse-engineer the Service; (e) create accounts using false information; or (f) share content that violates intellectual property rights. We reserve the right to suspend or terminate accounts that violate these rules.
          </Section>

          <Section icon={<Heart className="w-4 h-4 text-[#FF5E7E]" />} title="4. Content & Media" delay={0.7}>
            You retain ownership of content you post on Quicky, including photos, videos, bios, and messages. By posting content, you grant Quicky a worldwide, non-exclusive, royalty-free license to use, display, and process that content for the purpose of operating the Service. Quicky media (disappearing photos/videos) are deleted from our servers after they expire or are consumed. You are solely responsible for any content you share.
          </Section>

          <Section icon={<Scale className="w-4 h-4 text-[#FF5E7E]" />} title="5. Subscriptions & Payments" delay={0.8}>
            Quicky offers Premium subscriptions with enhanced features. Subscriptions are billed through your device&apos;s app store (Apple App Store or Google Play Store). Subscription fees are non-refundable except as required by law. You may cancel your subscription at any time through your device&apos;s store settings. Cancellation takes effect at the end of the current billing period. We reserve the right to change pricing with reasonable advance notice.
          </Section>

          <Section icon={<Shield className="w-4 h-4 text-[#FF5E7E]" />} title="6. Privacy" delay={0.9}>
            Your privacy is important to us. Our Privacy Policy, which is incorporated into these Terms by reference, describes how we collect, use, and protect your personal information. By using the Service, you consent to the data practices described in our Privacy Policy.
          </Section>

          <Section icon={<AlertTriangle className="w-4 h-4 text-[#FF5E7E]" />} title="7. Disclaimers & Limitation of Liability" delay={1.0}>
            The Service is provided &quot;as is&quot; without warranties of any kind. We do not guarantee that the Service will be uninterrupted, secure, or error-free. To the maximum extent permitted by law, Quicky shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service. You use the Service at your own risk.
          </Section>

          <Section icon={<RefreshCw className="w-4 h-4 text-[#FF5E7E]" />} title="8. Changes to Terms" delay={1.1}>
            We may update these Terms from time to time. We will notify you of material changes through the app or via email. Your continued use of the Service after changes take effect constitutes acceptance of the updated Terms. We encourage you to review these Terms periodically.
          </Section>

          <Section icon={<FileText className="w-4 h-4 text-[#FF5E7E]" />} title="9. Contact" delay={1.2}>
            If you have questions about these Terms, please contact us at <span className="text-[#FF5E7E] font-medium">legal@quicky.app</span>. For support-related questions, use the Help &amp; Support option in Settings.
          </Section>
        </div>
      </div>
    </SettingsSubScreen>
  )
}

export function PrivacyPolicyScreen() {
  return (
    <SettingsSubScreen title="Privacy Policy">
      <div className="px-5 py-5">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center text-center mb-6"
        >
          <motion.div
            initial={{ scale: 0, rotate: 10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#B8A4FF] to-[#FF5E7E] flex items-center justify-center glow-coral mb-3"
          >
            <Shield className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-white/50 mt-1">Last updated: August 2026 · v1.0</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-[#B8A4FF]/10 border border-[#B8A4FF]/30 rounded-2xl p-3 mb-4 flex items-start gap-2"
        >
          <Shield className="w-4 h-4 text-[#B8A4FF] shrink-0 mt-0.5" />
          <p className="text-xs text-white/80">
            Your privacy is at the core of Quicky. This policy explains what data we collect, why we collect it, and how you can control it.
          </p>
        </motion.div>

        <div className="flex flex-col gap-4">
          <Section icon={<FileText className="w-4 h-4 text-[#B8A4FF]" />} title="1. Information We Collect" delay={0.4}>
            We collect information you provide directly: your phone number (for verification), name, age, date of birth, gender, bio, city, photos, interests, and prompts. We also collect messages, Quicky media, swipe data, and usage analytics. Quicky media (disappearing photos/videos) are deleted from our servers after expiry.
          </Section>

          <Section icon={<Heart className="w-4 h-4 text-[#B8A4FF]" />} title="2. How We Use Your Data" delay={0.5}>
            We use your data to: (a) verify your identity and age; (b) match you with other users; (c) display your profile in discovery; (d) deliver messages and Quicky media; (e) compute your Quicky Score and streaks; (f) process Premium subscriptions; (g) prevent abuse and enforce our Community Guidelines. We do not sell your personal data to third parties.
          </Section>

          <Section icon={<Scale className="w-4 h-4 text-[#B8A4FF]" />} title="3. Data Sharing" delay={0.6}>
            We share limited data with service providers who help us operate (e.g., hosting, SMS OTP, push notifications, payment processing). These providers are contractually bound to protect your data. We may also disclose data if required by law or to protect our rights and safety. Your public profile data (name, age, photos, bio) is visible to other Quicky users in discovery.
          </Section>

          <Section icon={<Shield className="w-4 h-4 text-[#B8A4FF]" />} title="4. Your Privacy Controls" delay={0.7}>
            You control your privacy through Settings: (a) Hide your age or distance from your profile; (b) Hide your online status (Premium); (c) Hide your typing indicator (Premium); (d) Block users; (e) Make photos private so only matches can see them (Premium); (f) Manage notification preferences. You can edit or delete your profile data at any time through the Edit Profile screen.
          </Section>

          <Section icon={<AlertTriangle className="w-4 h-4 text-[#B8A4FF]" />} title="5. Data Retention" delay={0.8}>
            We retain your account data while your account is active. Quicky media are deleted after they expire or are viewed. Chat messages are retained for as long as your match is active. If you delete your account, we will delete your personal data within 30 days, except where retention is required by law (e.g., fraud prevention).
          </Section>

          <Section icon={<FileText className="w-4 h-4 text-[#B8A4FF]" />} title="6. Security" delay={0.9}>
            We use industry-standard security measures including encryption in transit (TLS) and at rest. Despite these measures, no system is 100% secure. We recommend using a strong device passcode and enabling two-factor authentication on your device. If you suspect unauthorized access, contact us immediately.
          </Section>

          <Section icon={<RefreshCw className="w-4 h-4 text-[#B8A4FF]" />} title="7. Your Rights" delay={1.0}>
            Depending on your jurisdiction (GDPR, CCPA, etc.), you may have rights to: (a) access the personal data we hold about you; (b) request correction or deletion of your data; (c) export your data in a portable format; (d) object to certain processing. To exercise these rights, contact us at <span className="text-[#B8A4FF] font-medium">privacy@quicky.app</span>.
          </Section>

          <Section icon={<Heart className="w-4 h-4 text-[#B8A4FF]" />} title="8. Children&apos;s Privacy" delay={1.1}>
            Quicky is not directed to anyone under 18. We do not knowingly collect personal data from children. If we learn that a user under 18 has registered, we will delete their account immediately. If you believe a minor is using the Service, please report it to <span className="text-[#B8A4FF] font-medium">safety@quicky.app</span>.
          </Section>

          <Section icon={<FileText className="w-4 h-4 text-[#B8A4FF]" />} title="9. Contact" delay={1.2}>
            For privacy questions or requests, contact us at <span className="text-[#B8A4FF] font-medium">privacy@quicky.app</span>. For legal questions, contact <span className="text-[#B8A4FF] font-medium">legal@quicky.app</span>.
          </Section>
        </div>
      </div>
    </SettingsSubScreen>
  )
}

function Section({
  icon, title, children, delay,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white/5 rounded-2xl p-4 border border-white/8"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-white/70 leading-relaxed pl-9">{children}</p>
    </motion.div>
  )
}
