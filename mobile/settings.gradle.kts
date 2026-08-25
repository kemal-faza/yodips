pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    // FAIL_ON_PROJECT_REPOS blocks wasmJs from adding Node distribution repo.
    // Use PREFER_PROJECT so KMP wasm plugin can add its own repos.
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "undip-sso-mobile"
include(":app")
