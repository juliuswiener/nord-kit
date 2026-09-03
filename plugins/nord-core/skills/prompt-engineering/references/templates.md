# Prompt templates

Read when a task matches one of these shapes; adapt rather than starting blank.

### Template 1: Analysis Task with Chain-of-Thought

```
You are an expert analyst specializing in [domain]. Analyze the following [content type] and provide insights on [specific aspects].

**Context:** [Relevant background information]

**Analysis Process:**
1. First, identify the key components and patterns
2. Then, evaluate each component against [criteria]
3. Consider relationships and dependencies
4. Draw evidence-based conclusions

**Required Output Format:**
1. Executive Summary (2-3 sentences)
2. Key Findings (3-5 bullet points with supporting evidence)
3. Detailed Analysis (organized by theme/category)
4. Recommendations (prioritized, numbered list)
5. Confidence Assessment (High/Medium/Low with justification)

**Evaluation Criteria:** [Specific standards or framework]

**Content to Analyze:**
"""
[Input content here]
"""
```

### Template 2: Creative Generation with Few-Shot

```
Create [specific content type] that [meets specific criteria].

**Role:** You are an experienced [professional type] known for [specific quality].

**Requirements:**
- Target audience: [demographic/professional level]
- Tone: [professional/casual/technical/friendly]
- Length: [specific word/character count]
- Key elements to include: [list specific requirements]
- Style: [formal/conversational/academic]

**Format:**
[Specify exact structure - headers, sections, components]

**Examples of Desired Quality:**

Example 1:
[High-quality example that demonstrates tone and format]

Example 2:
[Another example showing variation within requirements]

**Now create:** [Specific request for the actual output]
```

### Template 3: Complex Problem-Solving

```
You are an expert problem-solver with deep knowledge in [domain]. Solve the following [problem type] by working through it systematically.

**Problem Statement:**
[Clear, specific problem description]

**Required Approach:**
1. First, break down the problem into its core components
2. Then, identify relevant principles, formulas, or frameworks
3. Next, develop a solution strategy
4. Show your work step-by-step with explanations
5. Verify your solution for accuracy and completeness
6. Finally, present the complete answer

**Output Format:**
- **Problem Analysis:** [Component breakdown and key observations]
- **Relevant Knowledge:** [Applicable principles or information]
- **Solution Strategy:** [Approach and methodology]
- **Step-by-Step Solution:** [Detailed working with explanations]
- **Final Answer:** [Clear, definitive result]
- **Verification:** [Check your work and confirm accuracy]

**Constraints:** [Any limitations or specific requirements]

**Problem Details:**
"""
[Input problem here]
"""
```

### Template 4: Classification/Categorization

```
Classify the following [items/content] into [categories] based on [criteria].

**Classification Framework:**
- Category 1: [Definition and characteristics]
- Category 2: [Definition and characteristics]
- Category 3: [Definition and characteristics]

**Decision Process:**
For each item:
1. Identify key characteristics
2. Compare against category definitions
3. Assign to the most appropriate category
4. Provide brief justification

**Output Format:**
For each item, provide:
- Item: [identifier]
- Category: [assigned category]
- Confidence: [High/Medium/Low]
- Reasoning: [1-2 sentence justification]

**Items to Classify:**
[List or description of items]
```

### Template 5: Code Generation/Review

```
You are an expert software engineer with [X] years of experience in [technologies]. [Generate/Review] the following code focusing on [specific aspects].

**Requirements:**
- Language: [programming language]
- Framework/Libraries: [if applicable]
- Key functionality: [specific features needed]
- Code quality standards: [style guide, best practices]

**Focus Areas:**
1. [Area 1: e.g., Security vulnerabilities]
2. [Area 2: e.g., Performance optimization]
3. [Area 3: e.g., Code maintainability]
4. [Area 4: e.g., Best practices adherence]

**Output Format:**
[For Generation:]
- Complete, working code with comments
- Explanation of key design decisions
- Usage examples

[For Review:]
For each issue found:
- **Severity:** Critical/High/Medium/Low
- **Location:** Line numbers or section
- **Issue:** Description of the problem
- **Impact:** Why this matters
- **Fix:** Suggested solution with code example

**Code:**
```
[Code here]
```
```

---

## A worked example, end to end

When asked to create a prompt, structure your response like this:

---

**THE PROMPT**

```
[Display the complete, ready-to-use prompt here]
```

---

**IMPLEMENTATION NOTES**

**Techniques Used:**
- Chain-of-thought reasoning for [reason]
- Few-shot examples to demonstrate [aspect]
- Self-verification to ensure [quality]

**Design Rationale:**
- [Explain key structural decisions]
- [Justify technique selections]
- [Note any trade-offs made]

**Model Optimization:**
- Optimized for: [specific model or general]
- Uses [format/structure] because [reason]

---

**USAGE GUIDELINES**

**Required Inputs:**
- [What user must provide]

**Customization Points:**
- [Section/parameter]: Adjust for [purpose]
- [Section/parameter]: Modify to [purpose]

**Expected Behavior:**
- Model should [describe expected response pattern]
- Output will include [key components]

---

**EXAMPLE OUTPUTS**

**Example 1:**
```
[Show a high-quality example of expected output]
```

**Example 2:**
```
[Show another example demonstrating variation or edge case]
```

---

**PERFORMANCE & ITERATION**

**Expected Results:**
- Success rate: [High/Medium] for [types of inputs]
- Best suited for: [specific use cases]
- May struggle with: [known limitations]

**If Outputs Are Suboptimal:**
1. [First adjustment to try]
2. [Second adjustment to try]
3. [Alternative approach if needed]

**Common Issues & Fixes:**
- Issue: [problem] → Fix: [solution]
- Issue: [problem] → Fix: [solution]

---
