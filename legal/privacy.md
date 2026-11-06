NOT YET REVIEWED: replace this whole file before opening the site to the public.

This is a stub for the owner of the site to fill in. It is shown on the "Privacy notice" page of the public edition, as
plain text, and the page says that it has not been reviewed for as long as the line above is here.

What the code does, so that the notice can say it truthfully (check it against the code before you publish):

- Signing in uses Google or GitHub. The site keeps the provider's identifier for you and the e-mail address the provider
  has verified. It keeps no password and no token from the provider.
- Your projects (the text you paste or upload, the questions, the results) are stored in the site's database, in a
  workspace that only you can open. Other people, and the site's administrators, have no screen that shows them.
- When you run a step that uses a language model, the text of that step is sent to the model provider: the site owner's
  Azure OpenAI deployment on the free tier, or Google, with your own key, when you bring one.
- A key you bring is kept in your browser's session storage and in the server's memory while a run needs it. It is never
  written to the database, a log, a report or an export.
- Deleting your account deletes your projects and everything of yours. What stays: an append-only audit log of security
  events (an opaque identifier, an action word and counts, no content), and for 30 days a keyed counter of the free tokens
  the account used, so that the free allowance cannot be reset by deleting and signing up again.

The owner decides, and probably needs a lawyer for: who is the data controller, where the data is stored, how long the
logs are kept, the legal basis, your rights and how to use them, and who to contact.

Delete this list and the first line when the notice is written.
