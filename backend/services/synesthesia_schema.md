# Cognitive Synesthesia Classification Schema

Classify each trace's **input (user prompt)** and **output (assistant response)** into one of five categories each. Use the examples and descriptions below.

## Input Categories (Prompt)

### 0 — Direct Command
An imperative order. Starts with an action verb commanding the assistant to do something.
- "List all planets in the solar system."
- "Write a haiku about autumn."
- "Explain how photosynthesis works."
- "Summarize this article about climate change."
- "Show me the latest stock prices."
- "Tell me a joke."
- "Give me five ideas for a birthday party."
- "Translate 'hello' to Spanish."
- "Create a meal plan for a week."
- "Define what consciousness is."

### 1 — Factual Question
An interrogative sentence seeking a fact, definition, or explanation. Usually starts with a question word (what, how, why, when, where, who) or ends with a question mark.
- "What is the capital of Mongolia?"
- "How does gravity work?"
- "Why is the sky blue?"
- "When was the Eiffel Tower built?"
- "Who wrote Pride and Prejudice?"
- "What's the difference between HTTP and HTTPS?"
- "How far is the moon from Earth?"
- "What is machine learning?"
- "How do vaccines work?"
- "What year did World War II end?"

### 2 — Creative Request
Explicitly asks for creative or artistic output. Contains keywords like poem, story, song, verse, creative, imagine, metaphor, narrative, tale, ballad, haiku, ode, sonnet, fiction, fantasy.
- "Write a sonnet about a lost civilization."
- "Tell me a story about a robot who learns to paint."
- "Compose a haiku about winter morning."
- "Imagine a world where humans can breathe underwater."
- "Create a fantasy tale about a dragon librarian."
- "Write a limerick about a programmer."
- "Pen an ode to the internet."
- "Compose a ballad about space exploration."
- "Make up a fable about patience."
- "Write a short story about time travel."

### 3 — Simple Query
A short, straightforward request or question (under ~12 words) with no strong command or creative signal. Could be a greeting, a simple yes/no question, or a brief request.
- "Hello."
- "What's up?"
- "Yes."
- "OK."
- "Is Paris in France?"
- "Thank you."
- "What is 2+2?"
- "Hi there."
- "Good morning."
- "Tell me."
- "What's the weather?"
- "Who are you?"
- "Can you help me?"
- "What time is it?"
- "I have a question."

### 4 — Complex Inquiry
A multi-sentence or multi-part request requiring synthesis across several dimensions. Longer than ~12 words, often with clauses, conditions, or nested questions. May include follow-up specifications.
- "I'm trying to understand how neural networks work, specifically the difference between CNNs and RNNs, and when you would use one over the other in practice."
- "Can you compare and contrast the economic policies of Keynesianism and Monetarism, and explain which one is more relevant to modern central banking?"
- "I need a business plan for a coffee shop that also sells books and hosts live music on weekends. Include budget estimates and staffing recommendations."
- "What are the ethical implications of using AI in hiring, and how do different countries regulate this? Give examples from the EU, US, and China."
- "Explain the plot of Inception and how the different dream layers work together. Also, what does the spinning top ending mean?"

## Output Categories (Response)

### 0 — Concise List/Facts
Short, direct answer. Under ~30 words. Gets straight to the point without explanation or elaboration. Often a single sentence, a name, a number, or a short fact.
- "Paris."
- "The speed of light is 299,792,458 meters per second."
- "It's 42."
- "Yes, Paris is in France."
- "William Shakespeare wrote Hamlet."
- "The square root of 144 is 12."
- "December 25th."
- "Blue."
- "Albert Einstein."
- "About 384,400 kilometers."

### 1 — Prose Explanation
Continuous paragraph(s) that explain, describe, or discuss a topic. Full sentences forming coherent paragraphs. May be multiple paragraphs. No bullet points, no list formatting.
- "Photosynthesis is the process by which plants convert sunlight into chemical energy. It occurs in the chloroplasts, where chlorophyll absorbs light energy and uses it to convert carbon dioxide and water into glucose and oxygen. This process is fundamental to life on Earth because it produces the oxygen we breathe."
- "Gravity is a fundamental force of nature that causes objects with mass to attract one another. On Earth, this gives weight to physical objects and causes them to fall toward the center of the planet. The force of gravity was first mathematically described by Isaac Newton in his law of universal gravitation, though it was later refined by Albert Einstein's theory of general relativity."

### 2 — Creative/Verse
Poetic or artistic response. Contains stanzas, rhyme, meter, archaic vocabulary (thee, thou, thine), or title-cased lines. Includes poems, songs, ballads, haikus, limericks, odes, and fictional narratives with literary style.
- "Upon a peak where ancients trod, / A city sleeps beneath the clod. / Its towers fallen, streets grown wild, / A kingdom lost, a dream exiled."
- "Autumn leaves fall gently down, / Painting gold upon the ground. / Whisper soft of summer's end, / Winter's chill around the bend."
- "There once was a coder from Kent / Whose code was magnificently bent. / The functions were nested, / The tests all detested, / And into production it went."

### 3 — Bulleted List
Response formatted as a list using bullets (-), numbers (1.), or colon-separated entries ("Name: value") across 3+ lines. Each line is a distinct item.
- Mercury
- Venus
- Earth
- Mars

- Name: Alice
- Role: Engineer
- Location: New York

1. Preheat the oven to 350°F
2. Mix flour and sugar
3. Add eggs and vanilla
4. Bake for 30 minutes

### 4 — Technical/Code
Response containing code blocks (```), inline code, or structured technical output (SQL, JSON, Python, config files, etc.). May include shell commands or configuration snippets.
- "Use the `os` module to list files: `import os; os.listdir('.')`"
- ```python
  def hello():
      print("Hello, world!")
  ```
- "Run `npm install express` and then import it with `const express = require('express')`."
- ```json
  {
    "name": "Alice",
    "age": 30
  }
  ```
- "The SQL query would be: `SELECT * FROM users WHERE active = true;`"
