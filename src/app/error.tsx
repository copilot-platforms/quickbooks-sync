'use client'

import { Button } from 'copilot-design-system'
import Linkify from 'react-linkify'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main>
      <div className="flex flex-col justify-center items-center">
        <p className="mb-2 [&>a:hover]:underline [&>a]:block">
          <Linkify
            componentDecorator={(decoratedHref, decoratedText, key) => (
              <a target="blank" href={decoratedHref} key={key}>
                {decoratedText}
              </a>
            )}
          >
            {error.message}.
          </Linkify>
        </p>
        <Button label="Try again" onClick={() => reset()} />
      </div>
    </main>
  )
}
