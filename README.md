# Timla

> **Status: idea stage — nothing usable yet.** This repo is the starting
> point for development; expect everything to change. The first milestone
> ([MVP](https://github.com/timla-se/timla/milestone/1)) covers only the
> staff-scheduling (work schedule) module — booking modules come later.

Timla is an open-source, composable platform for time, booking and
scheduling, aimed at Swedish organizations — hair salons, sports clubs,
restaurants, freelancers, and everyone else whose day revolves around a
calendar.

Existing tools (Calendly, Planday, Doodle) each solve *one* problem. Timla
is the composable layer underneath: a core time engine with modules for
appointment booking, staff scheduling, resource booking, time reporting and
meeting planning. The primary end-user interface is a web UI (booking page,
calendar, schedule); an agent interface is an optional parallel channel
built on the same API primitives.

Timla is part of the same family as [OpenVera](https://github.com/openvera/openvera)
(bookkeeping) and shares its philosophy: build primitives that drive both
web UI and agents, keep data self-hostable, integrate with the Swedish
ecosystem (Swish, BankID, SMS reminders).

## License

[MIT](LICENSE)
