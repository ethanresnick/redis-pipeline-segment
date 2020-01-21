# redis-pipeline-segment

Makes it easy to compose segments of a redis pipeline, including to process multiple command results as a group (to return a single value from them) and to feed the results from one (set of) commands to the function that creates the result for another set.
