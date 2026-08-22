'use client'

import { useSignIn, useSignUp } from '@clerk/react'
import { useRouter } from 'next/navigation'
import React from 'react'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'

export default function AuthFlow() {
  const { signIn, errors, fetchStatus } = useSignIn()
  const { signUp } = useSignUp()
  const router = useRouter()

  const [emailAddress, setEmailAddress] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [showEmailCode, setShowEmailCode] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const { error } = await signIn?.password({
      emailAddress,
      password,
    })
    if (error) {
      // See https://clerk.com/docs/guides/development/custom-flows/error-handling
      // for more info on error handling
      console.error(JSON.stringify(error, null, 2))

      // If the identifier is not found, the user is not signed up yet
      // So swap to the sign-up flow
      if (error.code === 'form_identifier_not_found') {
        try {
          const { error } = await signUp.password({
            emailAddress,
            password,
          })

          // Send the user an email with the verification code
          if (!error) await signUp.verifications.sendEmailCode()

          // Display second form to capture the verification code
          if (
            signUp.status === 'missing_requirements' &&
            signUp.unverifiedFields.includes('email_address') &&
            signUp.missingFields.length === 0
          ) {
            setShowEmailCode(true)
            return
          }
        } catch (err: any) {
          // See https://clerk.com/docs/guides/development/custom-flows/error-handling
          // for more info on error handling
          console.error(JSON.stringify(err, null, 2))
        }
      }
    }

    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ session, decorateUrl }: any) => {
          if (session?.currentTask) {
            //  Handle pending session tasks
            // See https://clerk.com/docs/guides/development/custom-flows/authentication/session-tasks
            console.log(session?.currentTask)
            return
          }

          const url = decorateUrl('/')
          if (url.startsWith('http')) {
            window.location.href = url
          } else {
            router.push(url)
          }
        },
      })
    } else if (signIn.status === 'needs_second_factor') {
      // See https://clerk.com/docs/guides/development/custom-flows/authentication/multi-factor-authentication
    } else if (signIn.status === 'needs_client_trust') {
      // For other second factor strategies,
      // see https://clerk.com/docs/guides/development/custom-flows/authentication/device-trust
      const emailCodeFactor = signIn.supportedSecondFactors.find(
        (factor: any) => factor.strategy === 'email_code',
      )

      if (emailCodeFactor) {
        await signIn.mfa.sendEmailCode()
      }
    } else {
      // Check why the sign-in is not complete
      console.error('Sign-in attempt not complete:', signIn)
    }
  }

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Flow for signing up a new user
    if (showEmailCode) {
      // Use the code the user provided to attempt verification
      const { error } = await signUp.verifications.verifyEmailCode({
        code,
      })
      if (error) {
        // See https://clerk.com/docs/guides/development/custom-flows/error-handling
        // for more info on error handling
        console.error(JSON.stringify(error, null, 2))
        return
      }

      // If verification was completed, set the session to active
      // and redirect the user
      if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: async ({ session, decorateUrl }: any) => {
            // Handle session tasks
            // See https://clerk.com/docs/guides/development/custom-flows/authentication/session-tasks
            if (session?.currentTask) {
              console.log(session?.currentTask)
              return
            }

            // If no session tasks, navigate the signed-in user to the home page
            const url = decorateUrl('/')
            if (url.startsWith('http')) {
              window.location.href = url
            } else {
              router.push(url)
            }
          },
        })
      } else {
        // Check why the status is not complete
        console.error('Sign-up attempt not complete. Status:', signUp.status)
      }
    }

    // Flow for signing in an existing user
    const { error } = await signIn.mfa.verifyEmailCode({
      code,
    })
    if (error) {
      // See https://clerk.com/docs/guides/development/custom-flows/error-handling
      // for more info on error handling
      console.error(JSON.stringify(error, null, 2))
      return
    }

    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: async ({ session, decorateUrl }: any) => {
          if (session?.currentTask) {
            console.log(session?.currentTask)
            return
          }

          const url = decorateUrl('/')
          if (url.startsWith('http')) {
            window.location.href = url
          } else {
            router.push(url)
          }
        },
      })
    } else {
      // Check why the status is not complete
      console.error('Sign-in attempt not complete. Status:', signIn.status)
    }
  }

  if (showEmailCode || signIn.status === 'needs_client_trust') {
    return (
      <>
        <h1>Verify your account</h1>
        <form onSubmit={handleVerify}>
          <div>
            <label htmlFor="code">Code</label>
            <input
              id="code"
              name="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {errors.fields.code && <p>{errors.fields.code.message}</p>}
          </div>
          <button type="submit" disabled={fetchStatus === 'fetching'}>
            Verify
          </button>
        </form>
        <button onClick={() => signIn.mfa.sendEmailCode()}>I need a new code</button>
        <button onClick={() => signIn.reset()}>Start over</button>
      </>
    )
  }

  return (
    <div className='flex flex-col items-start justify-center w-full h-full gap-4 p-8'>
      <h1 className='text-2xl text-left'>Sign up/sign in</h1>
      <form onSubmit={handleSubmit} className='flex flex-col gap-4 w-full'>
        <div className='flex flex-col space-y-2'>
          <Label htmlFor="email">Enter email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
          />
          {errors.fields.identifier && <p>{errors.fields.identifier.message}</p>}
        </div>
        <div className='space-y-2'>
          <Label htmlFor="password">Enter password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {errors.fields.password && <p>{errors.fields.password.message}</p>}
        </div>
        <Button variant="default" type="submit" disabled={fetchStatus === 'fetching'}>
          Continue
        </Button>
      </form>

      {/* Required for sign-up flows. Clerk's bot sign-up protection is enabled by default */}
      <div id="clerk-captcha" />
    </div>
  )
}
