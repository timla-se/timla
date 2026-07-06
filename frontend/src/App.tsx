import { Route, Routes } from 'react-router'
import { Flex, Heading, Text } from '@radix-ui/themes'

function Home() {
  return (
    <Flex direction="column" align="center" justify="center" gap="2" style={{ minHeight: '100vh' }}>
      <Heading size="8">Timla</Heading>
      <Text color="gray">Tid, bokning och schemaläggning — under uppbyggnad.</Text>
    </Flex>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  )
}
