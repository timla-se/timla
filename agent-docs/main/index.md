# Main Branch

**Branch:** main

## Overview

Timla is an open-source, composable platform for time, booking and
scheduling, aimed at Swedish organizations — hair salons, sports clubs,
restaurants, freelancers, and everyone else whose day revolves around a
calendar. It is the composable layer underneath single-purpose tools
(Calendly, Planday, Doodle): a core time engine with modules for
appointment booking, staff scheduling, resource booking, time reporting
and meeting planning.

The current milestone
([MVP](https://github.com/timla-se/timla/milestone/1)) covers only the
staff-scheduling (arbetsschema) module. Backend is Flask + Postgres (raw
psycopg3, Alembic migrations, no ORM); frontend is React 19 + Vite in an
npm workspace. The API follows a composable primitives convention — see
[docs/primitives.md](../../docs/primitives.md).

## Context Files

(Add project-brief.md, tech-context.md, etc. as the project matures)
