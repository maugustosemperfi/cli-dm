package mapper

import "regexp"

var (
	ReGitOp      = regexp.MustCompile(`git\s+(checkout|branch|commit|push|pull|merge|rebase|stash|diff|log|status|clone|fetch)`)
	ReTestRunner = regexp.MustCompile(`(npm\s+(run\s+)?test|yarn\s+test|pytest|go\s+test|cargo\s+test|monocli\s+test|flutter\s+test|jest|vitest|rspec)`)
	ReBuild      = regexp.MustCompile(`(npm\s+run\s+build|yarn\s+build|cargo\s+build|go\s+build|make\b|gradle\b|mvn\b|webpack|vite\s+build|flutter\s+build)`)
	ReInstall    = regexp.MustCompile(`(npm\s+install|yarn\s+install|pip\s+install|go\s+mod\s+(tidy|download)|cargo\s+fetch|pub\s+get|pod\s+install|monocli\s+deps)`)
	ReBlocked    = regexp.MustCompile(`(?i)(blocked\s+by|waiting\s+for|can'?t\s+proceed|dependency\s+not\s+(met|ready)|prerequisite\s+not)`)
	ReConflict   = regexp.MustCompile(`(?i)(merge\s+conflict|conflict\s+in|CONFLICT\s+\(|<<<<<<)`)
	ReRateLimit  = regexp.MustCompile(`(?i)(rate\s+limit|too\s+many\s+requests|429|quota\s+exceeded|throttl)`)
	ReError      = regexp.MustCompile(`(?i)(^error:|^Error:|FAILED|panic:|FATAL|exception:|traceback|compilation\s+failed|build\s+failed)`)
)
