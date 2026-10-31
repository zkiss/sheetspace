import org.gradle.api.tasks.compile.JavaCompile
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.21"
    kotlin("plugin.serialization") version "2.2.21"
    application
    jacoco
    checkstyle
}

group = "com.sheetspace"
version = "0.1.0"

repositories {
    mavenCentral()
}

checkstyle {
    toolVersion = "10.26.1"
}

dependencies {
    implementation("org.graalvm.polyglot:polyglot:24.1.2")
    runtimeOnly("org.graalvm.polyglot:js-community:24.1.2")
    implementation("io.ktor:ktor-server-core-jvm:2.3.13")
    implementation("io.ktor:ktor-server-netty-jvm:2.3.13")
    implementation("io.ktor:ktor-server-content-negotiation-jvm:2.3.13")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm:2.3.13")
    implementation("org.flywaydb:flyway-core:12.3.0")
    implementation("org.flywaydb:flyway-database-nc-sqlite:12.3.0")
    implementation("org.xerial:sqlite-jdbc:3.50.3.0")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-server-test-host-jvm:2.3.13")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
}

application {
    mainClass.set("com.sheetspace.MainKt")
}

sourceSets.test {
    resources.srcDir(file("../test-fixtures"))
}

val checkCalculation by tasks.registering(Exec::class) {
    commandLine("node", "../frontend/node_modules/typescript/bin/tsc", "--project", "src/main/typescript/tsconfig.json")
}

val bundleCalculation by tasks.registering(Exec::class) {
    dependsOn(checkCalculation)
    inputs.dir("../frontend/src/calculation")
    inputs.dir("../frontend/src/workbook")
    inputs.file("../frontend/tsconfig.json")
    inputs.file("../frontend/package-lock.json")
    inputs.dir("src/main/typescript")
    val output = layout.buildDirectory.file("generated-resources/calculation/record-admission.js")
    outputs.file(output)
    commandLine("../frontend/node_modules/esbuild/bin/esbuild", "src/main/typescript/recordAdmission.ts",
        "--bundle", "--format=iife", "--global-name=RecordAdmission", "--platform=neutral", "--target=es2022",
        "--tsconfig=../frontend/tsconfig.json", "--outfile=${output.get().asFile}")
}

sourceSets.main { resources.srcDir(layout.buildDirectory.dir("generated-resources")) }
tasks.processResources { dependsOn(bundleCalculation) }

tasks.test {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

val coverageClassFilter = listOf(
    "**/MainKt.class",
    "**/*$*"
)

tasks.jacocoTestReport {
    reports {
        html.required.set(true)
        xml.required.set(true)
        csv.required.set(true)
    }
    classDirectories.setFrom(
        files(classDirectories.files.map { fileTree(it) { exclude(coverageClassFilter) } })
    )
}

tasks.jacocoTestCoverageVerification {
    classDirectories.setFrom(
        files(classDirectories.files.map { fileTree(it) { exclude(coverageClassFilter) } })
    )
    violationRules {
        rule {
            element = "BUNDLE"
            listOf(
                "INSTRUCTION",
                "BRANCH",
                "LINE",
                "METHOD",
                "CLASS",
            ).forEach { counter ->
                limit {
                    this.counter = counter
                    minimum = "0.95".toBigDecimal()
                }
            }
        }
    }
}

tasks.named<Checkstyle>("checkstyleMain") {
    source("src/main/kotlin")
    classpath = files()
}

tasks.named<Checkstyle>("checkstyleTest") {
    source("src/test/kotlin")
    classpath = files()
}

tasks.register<Copy>("copyFrontendDist") {
    from("../frontend/dist")
    into("src/main/resources/static")
}
