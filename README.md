# The Loading Message

A message, written by the artist while alive, encrypted and waiting.

A single percentage counts forward from 2026. It will reach 100% on a date
centuries from now. At that moment — and only that moment — the message
appears for the first time.

The encrypted message is in this repo. The key is not.

— Elmar Hamelink, 2026

## The piece

- **[theloadingmessage.com](https://theloadingmessage.com)** — the work itself. One number, counting.
- **[api.theloadingmessage.com](https://api.theloadingmessage.com/)** — the same number, as JSON, if you want to call it yourself.
- **[api.theloadingmessage.com/about](https://api.theloadingmessage.com/about)** — a little about the piece.

The ciphertext lives at [`api/message.json`](api/message.json). It is
AES-256-GCM. The key is a secret I hold and will not write down in any
place where it can be found after I am gone. The unlock date is also a
secret — knowing it would spoil the wait.

## What is here

```
api/     a small Go service that, on every request, returns the current
         percentage. when the moment arrives, it will also return the
         decrypted message.

web/     a static site. one page. it asks the api what the number is,
         and shows it.

pi/      a Python client for a Raspberry Pi, so the piece can live on a
         small screen in a room instead of a browser tab. it has an
         offline mode, for when there is no internet left.

scripts/ one script. it takes a message and a key and produces the
         ciphertext that lives in api/message.json. i used it once.
```

## If you are reading this in the future

Hello. I hope the message still decrypts. I hope someone is still running
the server, or that you found this repo and ran it yourself. If the
percentage you are looking at is 100 and the message is there, then the
piece has done what it was made to do, and you can close the tab.

If you are reading this before the date, then the wait is still the work.
